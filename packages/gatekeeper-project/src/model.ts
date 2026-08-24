// Everything about a project that is a decision rather than a database call: which paths mean
// which visibility, who may write what, what a comment may be anchored to, and which observation
// each read reveals. Kept free of Durable Object and RPC types so the rules can be tested directly.

import type {
  ProjectCommentAnchor,
  ProjectFileSummary,
  ProjectFileVisibility,
  ProjectRole,
} from "./types.js";

/** Path prefix that makes a file visible to the whole project without asking. */
export const SHARED_PREFIX = "shared/";

/** Longest path we accept, counted in characters. */
export const MAX_PATH_LENGTH = 512;

/** Longest comment body. Long enough for a review note, short enough to keep a file's list bounded. */
export const MAX_COMMENT_LENGTH = 8192;

/** Longest description on a file or configuration value. */
export const MAX_DESCRIPTION_LENGTH = 1024;

/** How much of a text file is indexed for search. Reads always return the whole file. */
export const MAX_INDEXED_TEXT_BYTES = 64 * 1024;

/** How long a signed link to a non-public file lasts. */
export const LINK_LIFETIME_MS = 10 * 60 * 1000;

/** The one file inside a widget that is code rather than an asset: its backend module. */
export const WIDGET_BACKEND_PATH = "backend.js";

/** What a widget serves when its address names no particular file. */
export const WIDGET_INDEX_PATH = "index.html";

/** Path segment under a widget reserved for its backend, so no asset may claim it. */
export const WIDGET_API_PREFIX = "api";

/**
 * The one route under `api/` this Worker answers itself, for a widget with no backend module.
 *
 * A widget that only wants to remember something should not need a backend, and a deployment
 * without Worker Loaders should not be a deployment where widgets cannot remember anything. So the
 * widget's own store -- the same Durable Object a backend would have been handed -- is served here
 * directly, as an HTTP API under this one prefix.
 *
 * Only for a widget with no `backend.js`. A widget that has one owns the whole of its `api/`,
 * `api/store` included: two things answering the same address would be a route whose behaviour
 * depends on a file the caller cannot see.
 */
export const WIDGET_STORE_PATH = "store";

/** Largest backend module we will hand to an isolate. A widget's backend is glue, not a bundle. */
export const MAX_WIDGET_BACKEND_BYTES = 128 * 1024;

/** How long a widget's backend has to answer one request before it is abandoned. */
export const WIDGET_BACKEND_TIMEOUT_MS = 10 * 1000;

/** Largest request body a widget's backend is handed. Buffered here, so the cap holds. */
export const MAX_WIDGET_REQUEST_BYTES = 1024 * 1024;

/** Names a widget's environment always defines itself, whatever the project calls its own values. */
export const RESERVED_WIDGET_ENV_NAMES: readonly string[] = ["WIDGET", "STORE"];

/** Limits on what one project may hold. Raising them is a deployment decision. */
export interface ProjectQuota {
  /** Largest single file, in bytes. */
  maxFileBytes: number;
  /** Total bytes across every file in the project. */
  maxProjectBytes: number;
  /** How many files one project may hold. */
  maxFileCount: number;
}

export const DEFAULT_QUOTA: ProjectQuota = {
  maxFileBytes: 10 * 1024 * 1024,
  maxProjectBytes: 1024 * 1024 * 1024,
  maxFileCount: 2000,
};

/**
 * A refusal the caller can act on, as opposed to a bug.
 *
 * Agents read these messages and retry, so each one says what to do instead -- "copy it" rather
 * than "forbidden". The class exists so the HTTP handler can answer 4xx rather than 500.
 */
export class ProjectError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "ProjectError";
  }
}

export function notFound(what: string): ProjectError {
  return new ProjectError(`${what} does not exist, or is not shared with you.`, 404);
}

const VISIBILITIES: readonly ProjectFileVisibility[] = ["private", "project", "public"];

export function isVisibility(value: unknown): value is ProjectFileVisibility {
  return typeof value === "string" && VISIBILITIES.includes(value as ProjectFileVisibility);
}

export function parseVisibility(value: unknown): ProjectFileVisibility {
  if (!isVisibility(value)) {
    throw new ProjectError(`Visibility must be one of ${VISIBILITIES.join(", ")}.`);
  }
  return value;
}

export function parseRole(value: unknown): ProjectRole {
  if (value !== "owner" && value !== "member") {
    throw new ProjectError("Role must be owner or member.");
  }
  return value;
}

/**
 * Reduce a caller-supplied path to the one form the project stores.
 *
 * Paths are identifiers here -- they decide default visibility and they collide with each other --
 * so the shapes that differ only in punctuation have to converge before anything reads them.
 */
export function normalizePath(input: unknown): string {
  if (typeof input !== "string") throw new ProjectError("A file path is required.");
  const segments: string[] = [];
  for (const raw of input.split("/")) {
    const segment = raw.trim();
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      throw new ProjectError("A file path may not contain '..'.");
    }
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\\]/.test(segment)) {
      throw new ProjectError("A file path may not contain control characters or backslashes.");
    }
    segments.push(segment);
  }
  const path = segments.join("/");
  if (path === "") throw new ProjectError("A file path is required.");
  if (path.length > MAX_PATH_LENGTH) {
    throw new ProjectError(`A file path may be at most ${MAX_PATH_LENGTH} characters.`);
  }
  return path;
}

/** The last segment of a path. */
export function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * Visibility for a file whose author did not choose one.
 *
 * Moving a file under `shared/` is the gesture people already make to share it, so the path is
 * taken as the intent and everything else stays private.
 */
export function defaultVisibility(path: string): ProjectFileVisibility {
  return path === SHARED_PREFIX.slice(0, -1) || path.startsWith(SHARED_PREFIX)
    ? "project"
    : "private";
}

/**
 * Visibility a file takes on when it is moved to `path`.
 *
 * The path is read as intent again, so dragging something into `shared/` shares it and dragging it
 * back out unshares it. A public file is the exception: publishing is deliberate enough that a
 * rename should not quietly undo it.
 */
export function visibilityAfterMove(
  previous: ProjectFileVisibility,
  path: string,
): ProjectFileVisibility {
  return previous === "public" ? "public" : defaultVisibility(path);
}

/** Whether `member` may read a file at this visibility. */
export function canRead(
  visibility: ProjectFileVisibility,
  ownerId: string,
  member: { memberId: string; isMember: boolean },
): boolean {
  if (visibility === "public") return true;
  if (!member.isMember) return false;
  return visibility === "project" || ownerId === member.memberId;
}

/**
 * Whether `member` may replace a file's contents.
 *
 * Only its owner may, project owners included: a project is a place to publish your own work and
 * comment on other people's, not to edit theirs. Everything else goes through `copyFile()`.
 */
export function canWrite(ownerId: string, memberId: string): boolean {
  return ownerId === memberId;
}

/** Whether `member` may delete a file. Its owner may; a project owner may, to moderate. */
export function canDelete(ownerId: string, member: { memberId: string; role: ProjectRole }): boolean {
  return ownerId === member.memberId || member.role === "owner";
}

// ---------------------------------------------------------------------------
// Widgets
//
// A widget is a mini app a member publishes into a project: static files plus an optional backend
// module. It reuses the file rules above rather than bringing its own -- the same three
// visibilities, the same path-is-intent default, the same owner-only writes -- because a member who
// understands who can read their files should not have to learn a second answer for who can open
// their widgets. What is new here is only what a widget has that a file does not: an address space
// of its own, and code.

/**
 * Who a widget's frontend and backend are answering.
 *
 * `public` is the absence of a capability rather than a capability of its own, which is exactly why
 * a public widget's link can be stable: there is nothing in it to expire.
 */
export type WidgetPrincipal =
  | { kind: "member"; memberId: string; role: ProjectRole }
  | { kind: "public" };

/**
 * A path inside a widget, as the widget stores it.
 *
 * Rejects `api/...` because that prefix is the widget's backend route: an asset stored there would
 * have an address nothing could reach, and finding that out by loading a blank page is worse than
 * being told here.
 */
export function normalizeWidgetPath(input: unknown): string {
  const path = normalizePath(input);
  if (path === WIDGET_API_PREFIX || path.startsWith(`${WIDGET_API_PREFIX}/`)) {
    throw new ProjectError(
      `A widget's ${WIDGET_API_PREFIX}/ path belongs to its backend, so no file may be stored ` +
      `there. Put the file somewhere else and let ${WIDGET_BACKEND_PATH} answer ` +
      `${WIDGET_API_PREFIX}/ requests.`);
  }
  return path;
}

/** Whether `path` names the one file inside a widget that runs as code. */
export function isWidgetBackendPath(path: string): boolean {
  return path === WIDGET_BACKEND_PATH;
}

/** The file a widget request resolves to: its index when the address names no file. */
export function widgetAssetPath(assetPath: string): string {
  return assetPath === "" ? WIDGET_INDEX_PATH : assetPath;
}

/**
 * What a browser may do with a widget's frontend.
 *
 * Deliberately not the file-preview policy. That one is `default-src 'none'; sandbox`, which is
 * right for a document nobody expects to run and fatal for an app: a widget has to execute its own
 * script or there is no widget. So the policy here says which powers it gets rather than none of
 * them, and `connect-src` names the widget's own backend, which is all the app should need.
 *
 * `'self'` is in `connect-src` as well because the widget is served from the deployment's own
 * origin and fetches its assets by relative URL. That also means CSP is not the wall between a
 * widget and the rest of the deployment -- same-origin never is. What keeps a widget's reach narrow
 * is the route, the path-scoped cookie, and the fact that its backend runs in an isolate with
 * nothing in it but what the widget was given.
 */
export function widgetContentSecurityPolicy(apiUrl: string): string {
  return [
    "default-src 'none'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${apiUrl}`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'self'",
  ].join("; ");
}

/**
 * The cookie a widget's own requests carry, scoped to that widget's path.
 *
 * Named per widget as well as scoped per widget: the path is what stops the browser sending it
 * anywhere else, and the name is what stops two widgets' cookies being mistaken for each other if a
 * deployment ever widens that path.
 */
export function widgetCookieName(widgetId: string): string {
  return `pw_${widgetId}`;
}

const TEXT_EXTENSIONS: Record<string, string> = {
  css: "text/css",
  csv: "text/csv",
  html: "text/html",
  js: "text/javascript",
  json: "application/json",
  jsonc: "application/json",
  md: "text/markdown",
  py: "text/x-python",
  sql: "application/sql",
  ts: "text/typescript",
  tsx: "text/typescript",
  txt: "text/plain",
  xml: "text/xml",
  yaml: "text/yaml",
  yml: "text/yaml",
};

const BINARY_EXTENSIONS: Record<string, string> = {
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  pdf: "application/pdf",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
  zip: "application/zip",
};

/** Content type implied by a path, for callers that do not supply one. */
export function inferMimeType(path: string): string {
  const name = fileName(path).toLowerCase();
  const dot = name.lastIndexOf(".");
  const extension = dot === -1 ? "" : name.slice(dot + 1);
  return TEXT_EXTENSIONS[extension] ?? BINARY_EXTENSIONS[extension] ?? "application/octet-stream";
}

/**
 * Whether a content type is one we can index, search, quote in a snippet, and hand back as text.
 *
 * Deliberately the same test upstream applies to chat attachments, so a file that reads as text in
 * a project reads as text when an agent attaches it.
 */
export function isTextLike(mimeType: string): boolean {
  if (mimeType.startsWith("image/")) return false;
  return mimeType.startsWith("text/") ||
    /\b(json|javascript|typescript|xml|yaml|csv|markdown|sql|x-python)\b/.test(mimeType);
}

const DATA_URI = /^data:([^;,]*)(;base64)?,/;

/** Bytes to store for a caller-supplied `content`, and the type they turned out to be. */
export function decodeContent(
  content: unknown,
  mimeType: string | undefined,
): { bytes: Uint8Array; mimeType?: string } {
  if (typeof content !== "string") {
    throw new ProjectError("File content must be a string, or a data: URI for binary content.");
  }
  const match = DATA_URI.exec(content);
  if (!match) return { bytes: new TextEncoder().encode(content), mimeType };
  const body = content.slice(match[0].length);
  const declared = match[1] || undefined;
  if (!match[2]) {
    let text: string;
    try {
      text = decodeURIComponent(body);
    } catch {
      // A refusal, like the base64 branch below: the agent wrote the URI, so it is the one that can
      // fix it, and a URIError escaping here would reach it as a 500 it can make nothing of.
      throw new ProjectError("The data: URI is not valid percent-encoded text.");
    }
    return { bytes: new TextEncoder().encode(text), mimeType: mimeType ?? declared };
  }
  let binary: string;
  try {
    binary = atob(body);
  } catch {
    throw new ProjectError("The data: URI is not valid base64.");
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { bytes, mimeType: mimeType ?? declared };
}

/** What `readFile()` returns for these bytes: their text, or a `data:` URI. */
export function encodeContent(bytes: Uint8Array, mimeType: string): string {
  if (isTextLike(mimeType)) return new TextDecoder().decode(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:${mimeType};base64,${btoa(binary)}`;
}

/** The prefix of a text file that gets indexed for search. */
export function indexedText(bytes: Uint8Array, mimeType: string): string {
  if (!isTextLike(mimeType)) return "";
  return new TextDecoder().decode(bytes.subarray(0, MAX_INDEXED_TEXT_BYTES));
}

/** Check a comment anchor, defaulting to the whole file. */
export function parseAnchor(value: unknown): ProjectCommentAnchor {
  if (value === undefined || value === null) return { kind: "file" };
  if (typeof value !== "object") throw new ProjectError("A comment anchor must be an object.");
  const anchor = value as Record<string, unknown>;
  switch (anchor.kind) {
    case "file":
      return { kind: "file" };
    case "page": {
      const page = anchor.page;
      if (typeof page !== "number" || !Number.isInteger(page) || page < 1) {
        throw new ProjectError("A page anchor needs a page number of 1 or more.");
      }
      return { kind: "page", page };
    }
    case "text": {
      const { start, end, quote } = anchor;
      if (typeof start !== "number" || !Number.isInteger(start) || start < 0 ||
          typeof end !== "number" || !Number.isInteger(end) || end < start) {
        throw new ProjectError("A text anchor needs integer character offsets with start <= end.");
      }
      if (typeof quote !== "string" || quote === "") {
        throw new ProjectError(
          "A text anchor needs the quoted text, so the comment survives an edit that moves it.");
      }
      return { kind: "text", start, end, quote: quote.slice(0, MAX_COMMENT_LENGTH) };
    }
    default:
      throw new ProjectError("A comment anchor must have kind file, page or text.");
  }
}

export function parseCommentBody(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ProjectError("A comment needs a body.");
  }
  if (value.length > MAX_COMMENT_LENGTH) {
    throw new ProjectError(`A comment may be at most ${MAX_COMMENT_LENGTH} characters.`);
  }
  return value;
}

export function parseDescription(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new ProjectError("A description must be a string.");
  return value.slice(0, MAX_DESCRIPTION_LENGTH);
}

/** Names for projects, members, skills and configuration values. */
export function parseName(value: unknown, what: string, max = 128): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ProjectError(`A ${what} is required.`);
  }
  const name = value.trim();
  if (name.length > max) {
    throw new ProjectError(`A ${what} may be at most ${max} characters.`);
  }
  return name;
}

/**
 * Configuration variable names.
 *
 * Restricted to the shape an environment variable already has, because that is where these end up:
 * a project's values are meant to be handed to a widget's environment, and a name that cannot be
 * spelled there is a name that fails much later than here.
 */
export function parseEnvVarName(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(value)) {
    throw new ProjectError(
      "A configuration name must start with a letter or underscore and contain only letters, " +
      "digits and underscores.");
  }
  return value;
}

export function parseLimit(value: unknown, fallback: number, max: number): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new ProjectError("A limit must be a positive integer.");
  }
  return Math.min(value, max);
}

/** A short excerpt of `text` around the first occurrence of `query`. */
export function snippet(text: string, query: string, radius = 120): string {
  if (text === "") return "";
  const at = text.toLowerCase().indexOf(query.toLowerCase());
  const start = at === -1 ? 0 : Math.max(0, at - radius);
  const end = at === -1 ? radius * 2 : Math.min(text.length, at + query.length + radius);
  const excerpt = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "..." : ""}${excerpt}${end < text.length ? "..." : ""}`;
}

/**
 * The data set an observation reveals, in the form `addObserver()` re-checks later.
 *
 * Three shapes, all naming the project so the verifier can find it: `p:<project>` for anything every
 * member may read, `f:<project>:<file>` for one file, whose visibility may since have narrowed, and
 * `w:<project>:<widget>` for one widget, which narrows the same way. A public file or widget reveals
 * nothing, since there is no one to keep it from.
 */
export function projectSet(projectId: string): string {
  return `p:${projectId}`;
}

export function fileSet(projectId: string, fileId: string): string {
  return `f:${projectId}:${fileId}`;
}

export function widgetSet(projectId: string, widgetId: string): string {
  return `w:${projectId}:${widgetId}`;
}

/** Sets revealed by handing back these files. */
export function fileSets(projectId: string, files: readonly ProjectFileSummary[]): string[] {
  const sets = new Set<string>();
  for (const file of files) {
    if (file.visibility !== "public") sets.add(fileSet(projectId, file.fileId));
  }
  return [...sets];
}

/** Sets revealed by handing back these widgets. */
export function widgetSets(
  projectId: string,
  widgets: readonly { widgetId: string; visibility: ProjectFileVisibility }[],
): string[] {
  const sets = new Set<string>();
  for (const widget of widgets) {
    if (widget.visibility !== "public") sets.add(widgetSet(projectId, widget.widgetId));
  }
  return [...sets];
}

export type ParsedSet =
  | { kind: "project"; projectId: string }
  | { kind: "file"; projectId: string; fileId: string }
  | { kind: "widget"; projectId: string; widgetId: string };

export function parseSet(setId: string): ParsedSet | null {
  const parts = setId.split(":");
  if (parts[0] === "p" && parts.length === 2 && parts[1]) {
    return { kind: "project", projectId: parts[1] };
  }
  if (parts[0] === "f" && parts.length === 3 && parts[1] && parts[2]) {
    return { kind: "file", projectId: parts[1], fileId: parts[2] };
  }
  if (parts[0] === "w" && parts.length === 3 && parts[1] && parts[2]) {
    return { kind: "widget", projectId: parts[1], widgetId: parts[2] };
  }
  return null;
}

/** Random hex id, for projects, files, comments and invite secrets. */
export function newId(bytes = 16): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * An invite code carrying the project it belongs to: `<projectId>.<secret>`.
 *
 * Self-describing so redeeming one needs no registry to look it up -- the code names the Durable
 * Object that can verify it, which stores only a hash of the secret.
 */
export function formatInviteCode(projectId: string, secret: string): string {
  return `${projectId}.${secret}`;
}

export function parseInviteCode(code: unknown): { projectId: string; secret: string } {
  if (typeof code !== "string") throw new ProjectError("An invite code is required.");
  const [projectId, secret, ...rest] = code.trim().split(".");
  if (!/^[\da-f]{32}$/.test(projectId ?? "") || !/^[\da-f]{32}$/.test(secret ?? "") ||
      rest.length > 0) {
    throw new ProjectError("That invite code is not valid.");
  }
  return { projectId, secret };
}

export async function hashSecret(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
