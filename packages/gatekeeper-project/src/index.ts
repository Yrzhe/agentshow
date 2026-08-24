// The Project gatekeeper Worker: shared projects for people whose agents are their own.
//
// Its HTTP surface exists for two reasons. A file needs an address a person can open, and an agent
// can quote, without going through an RPC session. And a widget -- a mini app a member publishes
// into a project -- needs an address that actually runs it: assets a browser will execute, and a
// backend that answers under the same address. The router forwards `/gatekeeper/project/*` here.
//
// This is the only part of the Worker with no member identity behind it, which is why the two
// widget routes below hand the decision straight back to the project's Durable Object on every
// single request rather than trusting whatever got the browser here.

import { configuredDomain, domainName } from "./domain.js";
import {
  ROUTE_PREFIX,
  parseFileUrl,
  parseProjectUrl,
  parseWidgetUrl,
  widgetApiUrl,
} from "./links.js";
import {
  LINK_LIFETIME_MS,
  ProjectError,
  widgetContentSecurityPolicy,
  widgetCookieName,
} from "./model.js";
import type { ProjectDurableObject } from "./project-store.js";
import { runWidgetBackend, widgetBackendRequest, widgetIsolateName } from "./widget-runtime.js";

export { ProjectDurableObject } from "./project-store.js";
export { MemberProjectsDurableObject } from "./member-index.js";
export { WidgetStoreDurableObject } from "./widget-store.js";
export {
  GatekeeperVendor,
  ProjectAccount,
  ProjectGatekeeper,
  ProjectVerifier,
} from "./project-gatekeeper.js";

/**
 * What a project link shows.
 *
 * Nothing about the project: an HTTP request arrives with no member identity, so answering "who is
 * asking" is not possible here, and a page that named the project would tell whoever holds the link
 * something only its members should know. The link's job is to be recognised by the agent it is
 * pasted to.
 */
const PROJECT_PAGE = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Shared project</title>
    <style>
      body { font: 16px/1.5 system-ui, sans-serif; margin: 4rem auto; max-width: 34rem;
             padding: 0 1rem; color: #1d1d1f; }
      code { background: #f2f2f4; border-radius: 4px; padding: 0.1rem 0.3rem; }
    </style>
  </head>
  <body>
    <h1>This is a link to a shared project</h1>
    <p>A project's files, comments, skills and settings are only visible to the people who have
      joined it, so there is nothing to show on this page.
    <p>Paste this link into a chat to point your own agent at the project, or ask it to
      <code>openProject()</code> with the id at the end of the address. If you have not joined yet,
      ask a member for an invitation code.
  </body>
</html>
`;

/** Methods a widget's backend may be asked to answer. A widget's assets are read-only. */
const BACKEND_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);

export default {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext): Promise<Response> {
    const widget = parseWidgetUrl(env, request.url);
    if (widget) {
      return serveWidget(request, env, ctx, widget);
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Only GET is supported here.", {
        status: 405,
        headers: { "content-type": "text/plain; charset=utf-8", allow: "GET, HEAD" },
      });
    }

    if (parseProjectUrl(env, request.url)) {
      return new Response(PROJECT_PAGE, {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      });
    }

    const file = parseFileUrl(env, request.url);
    if (!file) {
      return new Response("Not found.", {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    const store = projectStore(env, ctx, file.projectId);
    const found = await store.fetchForLink(
      file.fileId, new URL(request.url).searchParams.get("t"));
    if (!found.ok) return refusal(found.status, found.message);
    return new Response(found.bytes, {
      headers: {
        "content-type": found.mimeType,
        // Named, but not offered as a download: a project holds documents people want to look at.
        "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(found.name)}`,
        // A signed link is a short-lived capability, so nothing on the way may keep what it fetched.
        "cache-control": found.visibility === "public" ? "public, max-age=60" : "private, no-store",
        "x-content-type-options": "nosniff",
        // A member's file is served under the deployment's own origin, and displayed rather than
        // downloaded, so an HTML or SVG one would otherwise run as this deployment: with its
        // cookies, its Access session, and same-origin reach into everything else here. Nothing a
        // project file legitimately does needs script, a network, or an ambient origin.
        //
        // A widget is the case where script IS the point, which is why it is a different route with
        // a different policy rather than an exception carved into this one.
        "content-security-policy": "default-src 'none'; sandbox",
      },
    });
  },
};

/**
 * Serve a widget: its frontend, or its backend under `api/`.
 *
 * The capability comes from the query string on the first request and from a path-scoped cookie
 * afterwards, so the SPA's own fetches do not have to carry a token in every URL. Both are offered
 * together rather than in order of preference, because a link that has been open in a tab past its
 * expiry still has the stale token in its address bar while the cookie beside it is current.
 *
 * Neither is treated as a decision. The Durable Object re-derives who is asking from current
 * membership and current visibility on every request, and hands back a fresh cookie only while the
 * answer is still yes.
 */
async function serveWidget(
  request: Request,
  env: Cloudflare.Env,
  ctx: ExecutionContext,
  widget: { projectId: string; widgetId: string; assetPath: string; api: boolean },
): Promise<Response> {
  const url = new URL(request.url);
  const offered = [url.searchParams.get("t"), widgetCookie(request, widget.widgetId)]
    .filter((token): token is string => token !== null);
  const store = projectStore(env, ctx, widget.projectId);

  if (widget.api) {
    if (!BACKEND_METHODS.has(request.method)) {
      return refusal(405, "That method is not supported here.");
    }
    const opened = await store.openWidgetBackend(widget.widgetId, offered);
    if (!opened.ok) return refusal(opened.status, opened.message);
    // Declared in this package's own wrangler.jsonc, so the generated types say it is always there.
    // Checked anyway, because a deployment that strips the binding should get an answer that names
    // the reason rather than a TypeError out of the middle of a widget's request.
    const loader = env.WIDGET_LOADER as WorkerLoader | undefined;
    if (!loader) {
      return refusal(
        501,
        "This deployment cannot run widget backends: it has no Worker Loader binding.");
    }
    try {
      const answer = await runWidgetBackend(
        loader,
        {
          isolateName: widgetIsolateName(
            configuredDomain(env), opened.projectId, opened.widgetId, opened.revision,
            opened.principal),
          source: opened.source,
          identity: {
            projectId: opened.projectId,
            widgetId: opened.widgetId,
            principal: opened.principal,
          },
          envVars: opened.envVars,
          store: widgetStore(env, ctx, opened.projectId, opened.widgetId),
        },
        await widgetBackendRequest(request, widget.assetPath));
      // A backend's answer is data for the widget's own script, so it is never a document the
      // browser should render on this origin, whatever content type the widget chose.
      answer.headers.set("x-content-type-options", "nosniff");
      answer.headers.set("cache-control", "private, no-store");
      answer.headers.set("content-security-policy", "default-src 'none'; sandbox");
      return withWidgetCookie(answer, env, widget, opened.renewedToken);
    } catch (error) {
      const failure = error instanceof ProjectError ? error : new ProjectError(String(error), 500);
      return refusal(failure.status, failure.message);
    }
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("A widget's files are read-only. Use its api/ routes to change anything.", {
      status: 405,
      headers: { "content-type": "text/plain; charset=utf-8", allow: "GET, HEAD" },
    });
  }

  const found = await store.fetchWidgetAsset(widget.widgetId, offered, widget.assetPath);
  if (!found.ok) return refusal(found.status, found.message);

  const response = new Response(found.bytes, {
    headers: {
      "content-type": found.mimeType,
      "cache-control": found.visibility === "public" ? "public, max-age=60" : "private, no-store",
      "x-content-type-options": "nosniff",
      // Not the file-preview policy. A widget has to run its own script, so this one grants that and
      // names what else it may reach; see `widgetContentSecurityPolicy`.
      "content-security-policy": widgetContentSecurityPolicy(
        widgetApiUrl(env, widget.projectId, widget.widgetId)),
    },
  });
  return withWidgetCookie(response, env, widget, found.renewedToken);
}

/**
 * Attach a renewed capability, scoped to this one widget's path.
 *
 * `HttpOnly` so the widget's own script cannot read it, `Path` so the browser never sends it
 * anywhere else on the deployment, and `SameSite=Lax` so another site cannot make a browser use it.
 */
function withWidgetCookie(
  response: Response,
  env: Cloudflare.Env,
  widget: { projectId: string; widgetId: string },
  token: string | undefined,
): Response {
  if (token === undefined) return response;
  const path = `${ROUTE_PREFIX}/w/${widget.projectId}/${widget.widgetId}/`;
  const attributes = [
    `${widgetCookieName(widget.widgetId)}=${token}`,
    `Path=${path}`,
    `Max-Age=${Math.floor(LINK_LIFETIME_MS / 1000)}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  // Omitted on plain http, which is what local development serves: a `Secure` cookie is dropped
  // there, and a widget that cannot keep a session in development is a widget nobody can build.
  if (new URL(env.PUBLIC_BASE_URL || "http://localhost:8787").protocol === "https:") {
    attributes.push("Secure");
  }
  response.headers.append("set-cookie", attributes.join("; "));
  return response;
}

function widgetCookie(request: Request, widgetId: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  const name = widgetCookieName(widgetId);
  for (const pair of header.split(";")) {
    const at = pair.indexOf("=");
    if (at === -1) continue;
    if (pair.slice(0, at).trim() === name) return pair.slice(at + 1).trim();
  }
  return null;
}

function projectStore(
  env: Cloudflare.Env,
  ctx: ExecutionContext,
  projectId: string,
): DurableObjectStub<ProjectDurableObject> {
  const namespace = ctx.exports.ProjectDurableObject;
  return namespace.get(namespace.idFromName(domainName(configuredDomain(env), projectId)));
}

/**
 * One widget's own store.
 *
 * Named by project and widget together, so the store a backend is handed is the store of the widget
 * that is running and there is no name it could ask for instead -- it never sees the namespace.
 */
function widgetStore(
  env: Cloudflare.Env,
  ctx: ExecutionContext,
  projectId: string,
  widgetId: string,
) {
  const namespace = ctx.exports.WidgetStoreDurableObject;
  return namespace.get(
    namespace.idFromName(domainName(configuredDomain(env), `${projectId}/${widgetId}`)));
}

function refusal(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}
