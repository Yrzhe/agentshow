// Running a widget's backend.
//
// The module is a member's own code, so the question this file answers is not "is it safe" but "what
// is it able to reach". A Worker Loader gives the honest answer: the module is loaded as a real
// Worker in its own isolate, with an `env` this file builds by hand and a `globalOutbound` of null,
// which is the runtime's own switch for "this code has no network". Nothing is evaluated in this
// Worker's own scope, so nothing it could write reaches this Worker's bindings.
//
// What the backend gets is therefore exactly three things: the project's shared configuration, a
// `WIDGET` binding naming itself and whoever is asking, and a key-value store belonging to that one
// widget. What it does not get is the project's Durable Object, the R2 bucket, the caller's cookies,
// or a way out to the internet.

import {
  MAX_WIDGET_REQUEST_BYTES,
  ProjectError,
  RESERVED_WIDGET_ENV_NAMES,
  WIDGET_BACKEND_PATH,
  WIDGET_BACKEND_TIMEOUT_MS,
  type WidgetPrincipal,
} from "./model.js";

/**
 * The runtime a widget's backend is compiled against.
 *
 * Pinned rather than inherited: a widget written today should keep behaving as it did when its
 * author tested it, and this Worker's own compatibility date moves when this Worker is upgraded.
 */
const WIDGET_COMPATIBILITY_DATE = "2026-08-04";

/**
 * Request headers a widget's backend is allowed to see.
 *
 * An allowlist, not a denylist. The header that must never arrive is the Access cookie, but naming
 * it and its neighbours would mean keeping that list current with Cloudflare's; naming what a small
 * HTTP API actually needs does not go stale.
 */
const FORWARDED_HEADERS: readonly string[] = ["content-type", "accept", "accept-language"];

/**
 * Response headers a widget's backend is not allowed to set.
 *
 * A widget answers on the deployment's own origin, so a `set-cookie` from one would be a cookie for
 * the whole deployment, and its own security headers would override the ones the route applies.
 */
const STRIPPED_RESPONSE_HEADERS: readonly string[] = [
  "set-cookie",
  "content-security-policy",
  "content-security-policy-report-only",
  "x-content-type-options",
];

/** What the widget's backend sees as `env.WIDGET`. */
export interface WidgetIdentity {
  projectId: string;
  widgetId: string;
  /** Who this request is for: a project member, or anyone holding a public widget's link. */
  principal: WidgetPrincipal;
}

export interface WidgetBackendSpec {
  /** The isolate's cache key. Must change whenever `env` or `source` would. */
  isolateName: string;
  source: string;
  identity: WidgetIdentity;
  /** The project's shared configuration, which is what this widget's environment is made of. */
  envVars: Record<string, string>;
  /** The widget's own store, passed straight through as a binding. */
  store: unknown;
}

/**
 * The isolate name for one widget's backend serving one caller.
 *
 * The caller is part of the name because the principal is in `env`, and a loader hands back a
 * cached isolate without re-running the callback that built its `env`. So an isolate is per widget,
 * per revision, and per caller: a member never reaches an isolate built for somebody else's
 * principal, and a member whose role changed does not keep the old one.
 */
export function widgetIsolateName(
  sharingDomain: string,
  projectId: string,
  widgetId: string,
  revision: string,
  principal: WidgetPrincipal,
): string {
  const caller = principal.kind === "public"
    ? "public"
    : `member:${principal.memberId}:${principal.role}`;
  return [sharingDomain, projectId, widgetId, revision, caller].join("|");
}

/**
 * The environment one widget's backend runs with.
 *
 * The reserved names are assigned last, so a project that happens to have shared configuration
 * called `WIDGET` cannot shadow the binding that tells the backend who is asking. That is a rule
 * the agent-facing API states, rather than one a widget author discovers.
 */
export function widgetEnv(spec: WidgetBackendSpec): Record<string, unknown> {
  const env: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(spec.envVars)) {
    if (!RESERVED_WIDGET_ENV_NAMES.includes(name)) env[name] = value;
  }
  env.WIDGET = spec.identity;
  env.STORE = spec.store;
  return env;
}

/**
 * The request the backend is handed, in place of the one the browser sent.
 *
 * Rebuilt rather than forwarded, for two reasons. The browser's request carries the deployment's
 * Access session and the widget's own cookie, and neither is the backend's business. And its path
 * carries the whole route -- project id, widget id -- which the backend should not have to strip:
 * it sees `/api/...`, so a widget's backend reads the same whether it is private or published.
 */
export async function widgetBackendRequest(request: Request, assetPath: string): Promise<Request> {
  const source = new URL(request.url);
  const url = new URL(`/api${assetPath === "" ? "" : `/${assetPath}`}`, source.origin);
  url.search = source.search;

  const headers = new Headers();
  for (const name of FORWARDED_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }

  if (request.method === "GET" || request.method === "HEAD") {
    return new Request(url, { method: request.method, headers });
  }
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_WIDGET_REQUEST_BYTES) {
    throw new ProjectError(
      `That request body is ${declared} bytes; a widget's backend accepts at most ` +
      `${MAX_WIDGET_REQUEST_BYTES}.`, 413);
  }
  // Buffered here, so the limit is enforced before the widget's code is started rather than trusted
  // to a header the caller wrote.
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_WIDGET_REQUEST_BYTES) {
    throw new ProjectError(
      `That request body is ${body.byteLength} bytes; a widget's backend accepts at most ` +
      `${MAX_WIDGET_REQUEST_BYTES}.`, 413);
  }
  return new Request(url, { method: request.method, headers, body });
}

/**
 * Run a widget's backend for one request.
 *
 * The timeout is a wall clock the caller holds, not something the widget can be relied on to
 * respect: a module that loops or awaits forever is abandoned here, and the person waiting is told
 * so rather than left holding an open connection.
 */
export async function runWidgetBackend(
  loader: WorkerLoader,
  spec: WidgetBackendSpec,
  request: Request,
): Promise<Response> {
  const worker = loader.get(spec.isolateName, () => ({
    compatibilityDate: WIDGET_COMPATIBILITY_DATE,
    mainModule: WIDGET_BACKEND_PATH,
    modules: { [WIDGET_BACKEND_PATH]: spec.source },
    env: widgetEnv(spec),
    // The runtime's own answer to "may this code reach the internet": no. A widget that needs an
    // outside service asks its frontend to call it, where the deployment's own policies apply.
    globalOutbound: null,
  }));

  let response: Response;
  try {
    response = await worker.getEntrypoint().fetch(request, {
      signal: AbortSignal.timeout(WIDGET_BACKEND_TIMEOUT_MS),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Reported as the widget's failure rather than the deployment's: a 502 tells whoever is looking
    // that the thing that broke is the widget, and the message is the only thing its author has to
    // work from.
    throw new ProjectError(
      `The widget's backend did not answer: ${message}`, 502);
  }
  return sanitizeWidgetResponse(response);
}

/** The backend's answer, minus the headers a widget may not set on this origin. */
export function sanitizeWidgetResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const name of STRIPPED_RESPONSE_HEADERS) headers.delete(name);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
