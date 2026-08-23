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
function relativePath(env: { PUBLIC_BASE_URL?: string }, url: string): string | null {
  let pathname: string;
  try {
    pathname = new URL(url, publicOrigin(env)).pathname;
  } catch {
    return null;
  }
  if (!pathname.startsWith(`${ROUTE_PREFIX}/`)) return null;
  return pathname.slice(ROUTE_PREFIX.length + 1).replace(/\/+$/, "");
}
