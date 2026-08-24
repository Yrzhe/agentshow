// The backend a widget gets without writing one.
//
// A widget that only wants to remember something -- a list, a draft, a score -- needed a
// `backend.js` before this file existed, which meant it needed a Worker Loader on the account and a
// human to approve a module of code. Both of those are the right price for running somebody's own
// code; neither is the right price for `localStorage` that the next person to open the widget can
// see too.
//
// So this is the same store a backend would have been handed, exposed as a small JSON API on the
// widget's own `api/store`. It is not a smaller version of the isolate path and it is deliberately
// not extensible: there is exactly one resource here, the widget's own key-value store, and every
// route below addresses a key in it. No project files, no other widget's store, and -- the one that
// matters most -- none of the project's shared configuration. A backend can read those values
// because a member wrote the backend and somebody approved it; nothing here was written by anybody,
// so nothing here may hand them out.
//
// Who is asking has already been decided by the time these functions run, by the same
// `openWidgetApi` call the isolate path uses. This file only turns a method and a path into a store
// operation.

import { ProjectError, WIDGET_STORE_PATH } from "./model.js";
import {
  MAX_KEY_LENGTH,
  MAX_LIST,
  MAX_VALUE_BYTES,
  type WidgetStoreEntry,
} from "./widget-store.js";

/**
 * The store operations this API is allowed to reach.
 *
 * Structural rather than the Durable Object stub's own type, so what the API can do is stated here
 * rather than inherited: `deleteAll()` exists on the object and is not in this interface, because
 * throwing away a widget's whole store is something deleting the widget does, not something an
 * HTTP caller may ask for.
 */
export interface WidgetStoreOperations {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  list(opts?: { prefix?: string; limit?: number }): Promise<WidgetStoreEntry[]>;
}

/** Methods the built-in store answers, in the order a caller would meet them. */
const KEY_METHODS = "GET, HEAD, PUT, DELETE";

/**
 * Whether `assetPath` -- the path after a widget's `api/` -- addresses the built-in store.
 *
 * Answered before the store is reached, so that everything else under `api/` on a widget with no
 * backend is a 404 rather than a silent success: a widget calling `api/notes` should be told that
 * nothing answers there, not handed the store's own listing.
 */
export function isWidgetStorePath(assetPath: string): boolean {
  return assetPath === WIDGET_STORE_PATH || assetPath.startsWith(`${WIDGET_STORE_PATH}/`);
}

/**
 * Answer one request against a widget's own store.
 *
 * ```
 * GET    api/store?prefix=&limit=   -> { entries: [{ key, value }] }
 * GET    api/store/<key>            -> { key, value }, or 404
 * PUT    api/store/<key>            <- the request body, stored verbatim as the value
 * DELETE api/store/<key>            -> 204, whether or not the key was there
 * ```
 *
 * A value is the request body exactly as sent, with no envelope to unwrap. The alternative --
 * `{ "value": "..." }` -- reads better in a curl example and worse everywhere else: a widget
 * storing JSON would have to decide whether its own object had been unwrapped, and the answer
 * would depend on a content type it may not control. `PUT` a string, `GET` the same string back.
 */
export async function serveWidgetStore(
  store: WidgetStoreOperations,
  request: Request,
  assetPath: string,
): Promise<Response> {
  try {
    const key = storeKey(assetPath);
    return key === null
      ? await listing(store, request)
      : await entry(store, request, key);
  } catch (error) {
    const failure = error instanceof ProjectError ? error : new ProjectError(String(error), 500);
    return json({ error: failure.message }, failure.status);
  }
}

async function listing(store: WidgetStoreOperations, request: Request): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return refusal(
      "The listing at api/store is read-only. Address a key -- api/store/<key> -- to change one.",
      405,
      "GET, HEAD");
  }
  const params = new URL(request.url).searchParams;
  const prefix = params.get("prefix") ?? "";
  if (prefix.length > MAX_KEY_LENGTH) {
    throw new ProjectError(`A prefix may be at most ${MAX_KEY_LENGTH} characters.`);
  }
  return json({ entries: await store.list({ prefix, limit: limitOf(params.get("limit")) }) });
}

async function entry(
  store: WidgetStoreOperations,
  request: Request,
  key: string,
): Promise<Response> {
  switch (request.method) {
    case "GET":
    case "HEAD": {
      const value = await store.get(key);
      // Not an empty answer: a key that was never written and a key holding "" are different
      // facts, and a widget deciding whether to show its first-run state needs to tell them apart.
      if (value === null) return json({ error: `No value is stored under ${key}.` }, 404);
      return json({ key, value });
    }
    case "PUT": {
      const value = await body(request);
      await store.put(key, value);
      // The stored pair rather than an empty 200, so a caller can tell a write that landed from a
      // write that was quietly reshaped on the way in. Nothing reshapes it, and this is how a
      // widget author confirms that.
      return json({ key, value });
    }
    case "DELETE":
      await store.delete(key);
      // Idempotent on purpose: a widget retrying a delete after a dropped connection should get
      // the same answer the first attempt would have given it.
      return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
    default:
      return refusal(`A key in the store answers ${KEY_METHODS}.`, 405, KEY_METHODS);
  }
}

/**
 * The key an `api/` path addresses: null for the listing, a string for one entry.
 *
 * The tail is percent-decoded, so `a%2Fb` and `a/b` name the same key and a widget may namespace
 * its keys with slashes the way it would namespace paths. `parseWidgetUrl` has already refused any
 * `.` or `..` segment, so that decoding cannot produce a key that reads as a traversal.
 */
function storeKey(assetPath: string): string | null {
  if (assetPath === WIDGET_STORE_PATH) return null;
  const raw = assetPath.slice(WIDGET_STORE_PATH.length + 1);
  let key: string;
  try {
    key = decodeURIComponent(raw);
  } catch {
    throw new ProjectError("That key is not valid percent-encoded text.");
  }
  // `api/store/` with nothing after it. Refused rather than treated as the listing, because a
  // widget building its URLs from a variable that came out empty should hear about it.
  if (key === "") {
    throw new ProjectError("A key is required. Use api/store to list what is stored.");
  }
  return key;
}

function limitOf(raw: string | null): number {
  if (raw === null || raw === "") return MAX_LIST;
  const limit = Number(raw);
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new ProjectError("limit must be a whole number of 1 or more.");
  }
  return Math.min(limit, MAX_LIST);
}

/**
 * The value a `PUT` carries.
 *
 * Checked against the declared length first and then against what actually arrived, for the same
 * reason `widgetBackendRequest` does it in that order: the header is the caller's claim and the
 * byte count is the fact, and the point of the first check is to refuse a large body before
 * reading it rather than to trust it.
 */
async function body(request: Request): Promise<string> {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_VALUE_BYTES) {
    throw new ProjectError(
      `That value is ${declared} bytes; a widget store value may be at most ${MAX_VALUE_BYTES}.`,
      413);
  }
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_VALUE_BYTES) {
    throw new ProjectError(
      `That value is ${bytes.byteLength} bytes; a widget store value may be at most ` +
      `${MAX_VALUE_BYTES}.`, 413);
  }
  return new TextDecoder().decode(bytes);
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function refusal(message: string, status: number, allow: string): Response {
  const answer = json({ error: message }, status);
  answer.headers.set("allow", allow);
  return answer;
}
