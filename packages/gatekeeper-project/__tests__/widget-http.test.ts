// A widget over HTTP, through the Worker's own fetch handler.
//
// This is where a widget differs from everything else this Worker serves. A project file is sent
// under `default-src 'none'; sandbox`, which is right for a document and fatal for an app, so the
// widget route has a policy of its own -- and the first thing these suites check is that the two
// routes really do answer differently, because a widget served under the file policy would be a
// blank page and a file served under the widget policy would be a script running as this
// deployment.
//
// The backends here are really run: the Worker Loader binding is real in this pool, so `env` is the
// env the isolate gets and `globalOutbound: null` is the runtime's own refusal rather than a
// promise made in a comment.

import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { fileUrl } from "../src/links.js";
import type { ProjectFileVisibility } from "../src/types.js";
import {
  alice,
  bob,
  cookieOf,
  file,
  project,
  testEnv,
  widget,
  writeWidgetFile,
} from "./widget-fixtures.js";

describe("the widget route and the file route", () => {
  it("gives a widget a policy it can run under, and a file one it cannot", async () => {
    const { store, projectId } = await project();
    const published = await widget(store, { path: "shared/site", visibility: "public" });
    await writeWidgetFile(store, {
      widgetId: published.widgetId,
      path: "index.html",
      content: "<script src='app.js'></script>",
    });
    const document = await file(store, {
      path: "shared/post.html",
      content: "<script>fetch('/api/steal')</script>",
      mimeType: "text/html",
      visibility: "public",
    });

    const app = await SELF.fetch(published.url);
    const preview = await SELF.fetch(fileUrl(testEnv, projectId, document.fileId));

    // The same deployment, the same origin, the same content type -- and deliberately not the same
    // policy, because one of these is meant to run and the other is not.
    expect(app.status).toBe(200);
    expect(preview.status).toBe(200);
    expect(preview.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");

    const policy = app.headers.get("content-security-policy")!;
    expect(policy).not.toBe("default-src 'none'; sandbox");
    expect(policy).not.toContain("sandbox");
    expect(policy).toContain("script-src 'self' 'unsafe-inline'");
    // The widget's own backend is named in `connect-src`, so the policy records what the app is
    // for even where same-origin means CSP is not the wall that keeps it there.
    expect(policy).toContain(
      `connect-src 'self' ${published.url}api/`);
    expect(policy).toContain("frame-ancestors 'self'");
    expect(policy).toContain("base-uri 'none'");

    // Both routes keep the header that stops a browser guessing a different type than was declared.
    expect(app.headers.get("x-content-type-options")).toBe("nosniff");
    expect(preview.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("answers a widget's root with its index, and 404s a file it does not have", async () => {
    const { store } = await project();
    const published = await widget(store, { path: "shared/site", visibility: "public" });
    await writeWidgetFile(store, {
      widgetId: published.widgetId, path: "index.html", content: "<h1>site</h1>",
    });
    await writeWidgetFile(store, {
      widgetId: published.widgetId, path: "assets/app.js", content: "console.log(1)",
      mimeType: "text/javascript",
    });

    expect(await (await SELF.fetch(published.url)).text()).toBe("<h1>site</h1>");
    // Without the trailing slash too: a person who trims it should still land on the widget.
    expect(await (await SELF.fetch(published.url.replace(/\/$/, ""))).text()).toBe("<h1>site</h1>");

    const asset = await SELF.fetch(`${published.url}assets/app.js`);
    expect(asset.headers.get("content-type")).toBe("text/javascript");
    expect(await asset.text()).toBe("console.log(1)");

    expect((await SELF.fetch(`${published.url}missing.js`)).status).toBe(404);
    // A widget's files are read-only over HTTP; changing anything is its backend's business.
    expect((await SELF.fetch(published.url, { method: "POST" })).status).toBe(405);
  });

  it("refuses a traversal out of the widget's own address space", async () => {
    const { store, projectId } = await project();
    const published = await widget(store, { path: "shared/site", visibility: "public" });
    await writeWidgetFile(store, {
      widgetId: published.widgetId, path: "index.html", content: "<h1>site</h1>",
    });
    const secret = await file(store, {
      path: "alice/secret.md", content: "private", mimeType: "text/markdown",
      visibility: "private",
    });

    // The tail of a widget address is attacker-supplied, so it is the one place a traversal could
    // reach the rest of the route. It does not parse as a widget address at all.
    const escaped = await SELF.fetch(
      `${testEnv.PUBLIC_BASE_URL}/gatekeeper/project/w/${projectId}/${published.widgetId}` +
      `/../../f/${projectId}/${secret.fileId}`);
    expect(escaped.status).toBe(404);
    expect(await escaped.text()).not.toContain("private");
  });
});

describe("the capability a browser carries", () => {
  it("turns a signed link into a cookie scoped to that one widget", async () => {
    const { store, projectId } = await project();
    const shared = await widget(store, { path: "shared/dashboard" });
    await writeWidgetFile(store, {
      widgetId: shared.widgetId, path: "index.html", content: "<h1>members</h1>",
    });

    // No capability: a project widget is not a public one.
    expect((await SELF.fetch(shared.url)).status).toBe(404);

    const link = await store.mintWidgetLink(bob.memberId, shared.widgetId);
    const first = await SELF.fetch(link.url);
    expect(first.status).toBe(200);
    expect(await first.text()).toBe("<h1>members</h1>");

    const cookie = first.headers.get("set-cookie")!;
    expect(cookie).toContain(`pw_${shared.widgetId}=`);
    // The path is what stops the browser offering this capability anywhere else on the deployment,
    // and HttpOnly is what stops the widget's own script reading it.
    expect(cookie).toContain(`Path=/gatekeeper/project/w/${projectId}/${shared.widgetId}/`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("Max-Age=600");

    // And the cookie alone is enough afterwards, so the app's own fetches need no token in the URL.
    const later = await SELF.fetch(shared.url, { headers: { cookie: cookieOf(first) } });
    expect(later.status).toBe(200);
    expect(later.headers.get("cache-control")).toBe("private, no-store");
  });

  it("will not let one widget's cookie open another", async () => {
    const { store } = await project();
    const mine = await widget(store, { path: "shared/dashboard" });
    const other = await widget(store, { path: "shared/other", name: "Other" });
    for (const one of [mine, other]) {
      await writeWidgetFile(store, {
        widgetId: one.widgetId, path: "index.html", content: `<h1>${one.name}</h1>`,
      });
    }

    const link = await store.mintWidgetLink(bob.memberId, mine.widgetId);
    const opened = await SELF.fetch(link.url);
    const token = cookieOf(opened).split("=")[1];

    // Offered under the other widget's own cookie name, which is the only way a browser could ever
    // be talked into presenting it here. The widget id is inside the signature, so it fails.
    const moved = await SELF.fetch(other.url, {
      headers: { cookie: `pw_${other.widgetId}=${token}` },
    });
    expect(moved.status).toBe(404);
    expect(await moved.text()).toMatch(/does not exist, or is not shared with you/);
  });

  it("closes a browser that already had the widget open when it stops being shared", async () => {
    const { store } = await project();
    const shared = await widget(store, { path: "shared/dashboard" });
    await writeWidgetFile(store, {
      widgetId: shared.widgetId, path: "index.html", content: "<h1>members</h1>",
    });
    const cookie = cookieOf(
      await SELF.fetch((await store.mintWidgetLink(bob.memberId, shared.widgetId)).url));
    expect((await SELF.fetch(shared.url, { headers: { cookie } })).status).toBe(200);

    await store.setWidgetVisibility(alice.memberId, shared.widgetId, "private");
    // The cookie is still perfectly well signed and has not expired. It is the answer behind it
    // that changed, and that answer is worked out again on every single request.
    expect((await SELF.fetch(shared.url, { headers: { cookie } })).status).toBe(404);
  });

  it("opens a public widget with no capability, and stops when it is taken back", async () => {
    const { store } = await project();
    const published = await widget(store, { path: "shared/site", visibility: "public" });
    await writeWidgetFile(store, {
      widgetId: published.widgetId, path: "index.html", content: "<h1>open</h1>",
    });

    const open = await SELF.fetch(published.url);
    expect(open.status).toBe(200);
    // Nothing to keep: a stranger with a public link has no session to slide forward.
    expect(open.headers.get("set-cookie")).toBe(null);
    expect(open.headers.get("cache-control")).toBe("public, max-age=60");

    await store.setWidgetVisibility(alice.memberId, published.widgetId, "private");
    expect((await SELF.fetch(published.url)).status).toBe(404);
  });
});

/** A backend that answers with whatever the suite asks it about its own surroundings. */
const REPORTING_BACKEND = `
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/reach") {
      let outside = "no attempt";
      try {
        const answer = await fetch("https://example.com/");
        outside = "reached " + answer.status;
      } catch (error) {
        outside = "refused: " + error.message;
      }
      return Response.json({ outside, bindings: Object.keys(env).sort() });
    }
    if (url.pathname === "/api/store") {
      await env.STORE.put("note", url.searchParams.get("note") ?? "");
      return Response.json({ note: await env.STORE.get("note"), keys: await env.STORE.list() });
    }
    if (url.pathname === "/api/echo") {
      return Response.json({
        method: request.method,
        path: url.pathname,
        search: url.search,
        headers: [...request.headers.keys()].sort(),
        body: request.method === "GET" ? null : await request.text(),
      });
    }
    return Response.json({
      widget: env.WIDGET,
      greeting: env.GREETING ?? null,
      secret: env.API_TOKEN ?? null,
    });
  },
};
`;

async function withBackend(opts: { visibility: ProjectFileVisibility; source?: string }) {
  const { store, projectId } = await project();
  const one = await widget(store, {
    path: opts.visibility === "private" ? "alice/app" : "shared/app",
    visibility: opts.visibility,
  });
  await writeWidgetFile(store, {
    widgetId: one.widgetId, path: "index.html", content: "<h1>app</h1>",
  });
  await writeWidgetFile(store, {
    widgetId: one.widgetId,
    path: "backend.js",
    content: opts.source ?? REPORTING_BACKEND,
    mimeType: "text/javascript",
  });
  return { store, projectId, widget: one };
}

describe("a widget's backend, actually running", () => {
  it("is told who is asking and what the project has configured", async () => {
    const { store, projectId, widget: one } = await withBackend({ visibility: "project" });
    await store.setEnvVar(alice.memberId, "GREETING", "hello", "");
    await store.setEnvVar(alice.memberId, "API_TOKEN", "s3cret", "");

    const cookie = cookieOf(
      await SELF.fetch((await store.mintWidgetLink(bob.memberId, one.widgetId)).url));
    const answer = await SELF.fetch(`${one.url}api/whoami`, { headers: { cookie } });
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({
      widget: {
        projectId,
        widgetId: one.widgetId,
        // A principal, never a raw Access token and never somebody else's identity.
        principal: { kind: "member", memberId: "bob", role: "member" },
      },
      // Values, not just names: shared configuration is what lets a widget run for everybody.
      greeting: "hello",
      secret: "s3cret",
    });

    // A backend's answer is data for the widget's own script, never a document for this origin.
    expect(answer.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(answer.headers.get("x-content-type-options")).toBe("nosniff");
    expect(answer.headers.get("cache-control")).toBe("private, no-store");
  });

  it("sees an anonymous caller on a public widget", async () => {
    const { widget: one } = await withBackend({ visibility: "public" });
    const answer = await SELF.fetch(`${one.url}api/whoami`);
    expect(answer.status).toBe(200);
    expect(await answer.json()).toMatchObject({ widget: { principal: { kind: "public" } } });
  });

  it("holds nothing in its env but what it was given, and cannot reach the network", async () => {
    const { store, widget: one } = await withBackend({ visibility: "public" });

    // A project with nothing configured: the widget's whole environment is the two bindings this
    // Worker puts there. Not its R2 bucket, not the project's Durable Object, not the loader that
    // started the isolate, and no namespace it could name something else in.
    const bare = await (await SELF.fetch(`${one.url}api/reach`)).json() as {
      outside: string;
      bindings: string[];
    };
    expect(bare.bindings).toEqual(["STORE", "WIDGET"]);
    // The runtime's own refusal, not a promise this Worker made in a comment.
    expect(bare.outside).toMatch(/^refused: /);
    expect(bare.outside).toMatch(/not permitted to access the internet/);

    // Shared configuration is the only thing that widens it, and only by the names the project set.
    await store.setEnvVar(alice.memberId, "GREETING", "hello", "");
    const configured = await (await SELF.fetch(`${one.url}api/reach`)).json() as {
      bindings: string[];
    };
    expect(configured.bindings).toEqual(["GREETING", "STORE", "WIDGET"]);
  });

  it("will not let shared configuration shadow the bindings it must trust", async () => {
    const { store, widget: one } = await withBackend({
      visibility: "public",
      source: `
        export default {
          async fetch(request, env) {
            return Response.json({
              principal: env.WIDGET?.principal ?? null,
              store: typeof env.STORE?.get,
            });
          },
        };
      `,
    });
    // A project may legitimately name a value anything an environment variable can be called, this
    // included. What it may not do is replace the binding that says who is asking.
    await store.setEnvVar(alice.memberId, "WIDGET", "not the widget", "");
    await store.setEnvVar(alice.memberId, "STORE", "not the store", "");

    expect(await (await SELF.fetch(`${one.url}api/whoami`)).json()).toEqual({
      principal: { kind: "public" },
      store: "function",
    });
  });

  it("cannot read another member's private file, by any route it has", async () => {
    const { store, projectId, widget: one } = await withBackend({ visibility: "public" });
    const secret = await file(store, {
      path: "bob/secret.md",
      content: "bob's private notes",
      mimeType: "text/markdown",
      visibility: "private",
      memberId: bob.memberId,
    });

    // A backend that tries every door it can see: the deployment's own file route, and the store it
    // does have, asked for a key it does not own.
    const prying = `
      export default {
        async fetch(request, env) {
          const attempts = {};
          try {
            const answer = await fetch(
              "${testEnv.PUBLIC_BASE_URL}/gatekeeper/project/f/${projectId}/${secret.fileId}");
            attempts.overHttp = await answer.text();
          } catch (error) {
            attempts.overHttp = "refused: " + error.message;
          }
          attempts.throughStore = await env.STORE.get("${secret.fileId}");
          attempts.bindings = Object.keys(env).sort();
          return Response.json(attempts);
        },
      };
    `;
    await writeWidgetFile(store, {
      widgetId: one.widgetId, path: "backend.js", content: prying, mimeType: "text/javascript",
    });

    const answer = await (await SELF.fetch(`${one.url}api/pry`)).json() as {
      overHttp: string;
      throughStore: string | null;
      bindings: string[];
    };
    expect(answer.overHttp).toMatch(/^refused: /);
    expect(answer.overHttp).not.toContain("bob's private notes");
    // The store is the widget's own, so a file id is just a key nobody has written.
    expect(answer.throughStore).toBe(null);
    expect(answer.bindings).toEqual(["STORE", "WIDGET"]);

    // And the file itself is still exactly as reachable as it was: not at all, over that route.
    const direct = await SELF.fetch(fileUrl(testEnv, projectId, secret.fileId));
    expect(direct.status).toBe(404);
  });

  it("keeps a store of its own, per widget", async () => {
    const { store, widget: one } = await withBackend({ visibility: "public" });
    const other = await widget(store, { path: "shared/second", name: "Second" });
    await writeWidgetFile(store, {
      widgetId: other.widgetId, path: "backend.js", content: REPORTING_BACKEND,
      mimeType: "text/javascript",
    });
    await store.setWidgetVisibility(alice.memberId, other.widgetId, "public");

    expect(await (await SELF.fetch(`${one.url}api/store?note=first`)).json())
      .toEqual({ note: "first", keys: [{ key: "note", value: "first" }] });
    // A different widget, a different object: writing one does not show up in the other.
    expect(await (await SELF.fetch(`${other.url}api/store?note=second`)).json())
      .toEqual({ note: "second", keys: [{ key: "note", value: "second" }] });
    expect(await (await SELF.fetch(`${one.url}api/store?note=first`)).json())
      .toMatchObject({ note: "first" });
  });

  it("is handed a request with the route stripped and the caller's cookies removed", async () => {
    const { store, widget: one } = await withBackend({ visibility: "project" });
    const cookie = cookieOf(
      await SELF.fetch((await store.mintWidgetLink(bob.memberId, one.widgetId)).url));

    const answer = await SELF.fetch(`${one.url}api/echo?q=1`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json", authorization: "Bearer nope" },
      body: '{"hello":"world"}',
    });
    const echoed = await answer.json() as {
      method: string;
      path: string;
      search: string;
      headers: string[];
      body: string;
    };
    expect(echoed).toMatchObject({
      method: "POST",
      // The backend reads the same whether the widget is private or published: it never sees the
      // project id or the widget id in its own paths.
      path: "/api/echo",
      search: "?q=1",
      body: '{"hello":"world"}',
    });
    // The headers the backend is meant to have, and nothing the caller sent about themselves. The
    // capability that got the request this far never reaches the widget's code, and neither does
    // the deployment's Access session.
    expect(echoed.headers).not.toContain("cookie");
    expect(echoed.headers).not.toContain("authorization");
    expect(echoed.headers).toContain("content-type");
    // `content-length` is the runtime's own, added when this Worker rebuilt the request around the
    // body it had already buffered to enforce the size limit.
    expect(echoed.headers.filter((name) => name !== "content-length")).toEqual(["content-type"]);
  });

  it("answers 404 under api/ for a widget with no backend, and 404 for a stranger", async () => {
    const { store } = await project();
    const shared = await widget(store, { path: "shared/plain" });
    await writeWidgetFile(store, {
      widgetId: shared.widgetId, path: "index.html", content: "<h1>plain</h1>",
    });

    // No capability at all: nothing about the widget is admitted, its backend included.
    expect((await SELF.fetch(`${shared.url}api/anything`)).status).toBe(404);

    const cookie = cookieOf(
      await SELF.fetch((await store.mintWidgetLink(bob.memberId, shared.widgetId)).url));
    const answer = await SELF.fetch(`${shared.url}api/anything`, { headers: { cookie } });
    expect(answer.status).toBe(404);
    expect(await answer.text()).toMatch(/has no backend/);
  });

  it("reports a backend that will not start, as the widget's failure", async () => {
    const { widget: one } = await withBackend({
      visibility: "public",
      source: "this is not ( valid javascript",
    });
    const answer = await SELF.fetch(`${one.url}api/x`);
    // A 502 says the thing that broke is the widget rather than the deployment, and the message is
    // the only thing its author has to go on.
    expect(answer.status).toBe(502);
    expect(await answer.text()).toMatch(/The widget's backend did not answer/);
  });

  it("does not let a backend set cookies or its own policy on this origin", async () => {
    const { widget: one } = await withBackend({
      visibility: "public",
      source: `
        export default {
          async fetch() {
            return new Response("ok", { headers: {
              "set-cookie": "stolen=1; Path=/",
              "content-security-policy": "default-src *",
              "x-widget-note": "kept",
            } });
          },
        };
      `,
    });
    const answer = await SELF.fetch(`${one.url}api/headers`);
    expect(answer.status).toBe(200);
    // A cookie from a widget would be a cookie for the whole deployment.
    expect(answer.headers.get("set-cookie")).toBe(null);
    expect(answer.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    // Everything else it chose to say is its own business and comes through.
    expect(answer.headers.get("x-widget-note")).toBe("kept");
  });

  it("refuses a request body larger than a backend is meant to be handed", async () => {
    const { store, widget: one } = await withBackend({ visibility: "project" });
    const cookie = cookieOf(
      await SELF.fetch((await store.mintWidgetLink(bob.memberId, one.widgetId)).url));
    const answer = await SELF.fetch(`${one.url}api/echo`, {
      method: "POST",
      headers: { cookie, "content-type": "text/plain" },
      body: "x".repeat(1024 * 1024 + 1),
    });
    expect(answer.status).toBe(413);
    expect(await answer.text()).toMatch(/accepts at most/);
  });
});
