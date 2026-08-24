// The Project gatekeeper Worker: shared projects for people whose agents are their own.
//
// Its HTTP surface exists for one reason -- a file needs an address a person can open, and an agent
// can quote, without going through an RPC session. The router forwards `/gatekeeper/project/*` here.

import { configuredDomain, domainName } from "./domain.js";
import { parseFileUrl, parseProjectUrl } from "./links.js";

export { ProjectDurableObject } from "./project-store.js";
export { MemberProjectsDurableObject } from "./member-index.js";
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

export default {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext): Promise<Response> {
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

    const namespace = ctx.exports.ProjectDurableObject;
    const store = namespace.get(
      namespace.idFromName(domainName(configuredDomain(env), file.projectId)));
    const found = await store.fetchForLink(
      file.fileId, new URL(request.url).searchParams.get("t"));
    if (!found.ok) {
      return new Response(found.message, {
        status: found.status,
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
      });
    }
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
        "content-security-policy": "default-src 'none'; sandbox",
      },
    });
  },
};
