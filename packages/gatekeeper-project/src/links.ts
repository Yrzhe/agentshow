// Addresses. Every project and file has one, and the same strings serve three purposes: what a
// human opens, what an agent is handed to introduce one project to a chat, and what the worker's
// own fetch handler parses back.

/** Path the router forwards to this Worker, fixed by the `GATEKEEPER_PROJECT` binding name. */
export const ROUTE_PREFIX = "/gatekeeper/project";

/** Where the deployment answers, when nothing configured it. Matches upstream's local default. */
const LOCAL_ORIGIN = "http://localhost:8787";

/** The deployment's public origin, with no trailing slash. */
export function publicOrigin(env: { PUBLIC_BASE_URL?: string }): string {
  return (env.PUBLIC_BASE_URL || LOCAL_ORIGIN).replace(/\/+$/, "");
}

export function baseUrl(env: { PUBLIC_BASE_URL?: string }): string {
  return `${publicOrigin(env)}${ROUTE_PREFIX}`;
}

export function projectUrl(env: { PUBLIC_BASE_URL?: string }, projectId: string): string {
  return `${baseUrl(env)}/p/${projectId}`;
}

export function fileUrl(
  env: { PUBLIC_BASE_URL?: string },
  projectId: string,
  fileId: string,
): string {
  return `${baseUrl(env)}/f/${projectId}/${fileId}`;
}

/**
 * Where a widget answers, with the trailing slash that makes its relative URLs work.
 *
 * A widget is a directory, not a document: `index.html` loads `app.js` by writing `app.js`, and a
 * browser resolves that against the last slash. Without the slash the widget's own assets would be
 * looked for one level up, outside the widget.
 */
export function widgetUrl(
  env: { PUBLIC_BASE_URL?: string },
  projectId: string,
  widgetId: string,
): string {
  return `${baseUrl(env)}/w/${projectId}/${widgetId}/`;
}

/** Where a widget's backend answers. Used to name it in the widget's own content security policy. */
export function widgetApiUrl(
  env: { PUBLIC_BASE_URL?: string },
  projectId: string,
  widgetId: string,
): string {
  return `${widgetUrl(env, projectId, widgetId)}api/`;
}

/**
 * The widget a URL names, and what inside it, or null.
 *
 * Unlike a file address a widget address has depth: everything after the widget id is a path within
 * the widget, and the `api/` prefix there is the backend rather than a file. `assetPath` is empty
 * for the widget's root, which resolves to its index.
 */
export function parseWidgetUrl(
  env: { PUBLIC_BASE_URL?: string },
  url: string,
): { projectId: string; widgetId: string; assetPath: string; api: boolean } | null {
  const path = relativePath(env, url, { keepTrailingSlash: true });
  if (path === null) return null;
  const parts = path.split("/");
  if (parts.length < 3 || parts[0] !== "w") return null;
  if (!/^[\da-f]{32}$/.test(parts[1]) || !/^[\da-f]{32}$/.test(parts[2])) return null;
  const rest = parts.slice(3);
  // A widget's own path may not contain `..`, so neither may an address claiming to name one: this
  // is the traversal check for a route whose tail is attacker-supplied.
  if (rest.some((segment) => segment === "." || segment === "..")) return null;
  const api = rest[0] === "api";
  return {
    projectId: parts[1],
    widgetId: parts[2],
    assetPath: api ? rest.slice(1).join("/") : rest.filter((segment) => segment !== "").join("/"),
    api,
  };
}

/** URLPattern for a single project, the one resource type this gatekeeper offers. */
export function projectUrlPattern(env: { PUBLIC_BASE_URL?: string }): string {
  return `${baseUrl(env)}/p/:projectId`;
}

/** The project a URL names, or null when it names something else. */
export function parseProjectUrl(
  env: { PUBLIC_BASE_URL?: string },
  url: string,
): string | null {
  const path = relativePath(env, url);
  if (!path) return null;
  const parts = path.split("/");
  return parts.length === 2 && parts[0] === "p" && /^[\da-f]{32}$/.test(parts[1])
    ? parts[1]
    : null;
}

/** The `<projectId, fileId>` a URL names, or null. */
export function parseFileUrl(
  env: { PUBLIC_BASE_URL?: string },
  url: string,
): { projectId: string; fileId: string } | null {
  const path = relativePath(env, url);
  if (!path) return null;
  const parts = path.split("/");
  if (parts.length !== 3 || parts[0] !== "f") return null;
  if (!/^[\da-f]{32}$/.test(parts[1]) || !/^[\da-f]{32}$/.test(parts[2])) return null;
  return { projectId: parts[1], fileId: parts[2] };
}

/**
 * A URL's path below this Worker's route prefix.
 *
 * The host is deliberately not compared. A deployment reaches its own Worker under whichever origin
 * `PUBLIC_BASE_URL` names, but people paste links from a preview host, an alias, or with the port
 * left off, and the ids that follow are unguessable, so the path is what identifies the resource.
 */
function relativePath(
  env: { PUBLIC_BASE_URL?: string },
  url: string,
  opts: { keepTrailingSlash?: boolean } = {},
): string | null {
  let pathname: string;
  try {
    pathname = new URL(url, publicOrigin(env)).pathname;
  } catch {
    return null;
  }
  if (!pathname.startsWith(`${ROUTE_PREFIX}/`)) return null;
  const path = pathname.slice(ROUTE_PREFIX.length + 1);
  // A widget address keeps its trailing slash, because for a widget the slash is meaningful: it is
  // the difference between the widget's root and a file inside it whose name happens to be empty.
  return opts.keepTrailingSlash ? path : path.replace(/\/+$/, "");
}
