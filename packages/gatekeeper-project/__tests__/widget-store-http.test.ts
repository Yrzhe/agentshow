// The backend a widget gets without writing one.
//
// A widget with nothing in it but an `index.html` can remember things: `api/store` is the widget's
// own Durable Object served as a JSON API, which is what makes persistence something a widget has
// rather than something it has to be granted. So the first suite here is the whole feature in one
// case -- put, get, list, delete, from a widget with no `backend.js` -- and everything after it is
// about the boundary, because a store that anyone can read is not a store a member can use.
//
// The last suite runs with the Worker Loader binding taken away, which is the deployment this route
// exists for: an account without Dynamic Worker Loaders. Nothing about the store changes there, and
// a widget that does have a `backend.js` is told exactly what is missing.

import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { fileUrl } from "../src/links.js";
import { MAX_VALUE_BYTES } from "../src/widget-store.js";
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

/** A widget with nothing in it but a page: no backend module, and none wanted. */
async function plainWidget(opts: { visibility: "public" | "project" | "private" } = {
  visibility: "public",
}) {
  const { store, projectId } = await project();
  const one = await widget(store, {
    path: opts.visibility === "private" ? "alice/notes" : "shared/notes",
    name: "Notes",
    visibility: opts.visibility,
  });
  await writeWidgetFile(store, {
    widgetId: one.widgetId, path: "index.html", content: "<h1>notes</h1>",
  });
  return { store, projectId, widget: one };
}

/** `api/store`, and `api/store/<key>` when a key is named. */
function storeUrl(widgetUrl: string, key?: string): string {
  return `${widgetUrl}api/store${key === undefined ? "" : `/${key}`}`;
}

async function put(url: string, value: string, init: RequestInit = {}): Promise<Response> {
  return SELF.fetch(url, { ...init, method: "PUT", body: value });
}

/**
 * Run `body` with the loader binding gone, which is the account this whole route exists for.
 *
 * The pool binds a real Worker Loader, because the isolate suites need one -- so taking it off the
 * env the handler reads is how a suite gets at the deployment that has none. Restored afterwards,
 * since every other suite in this pool is relying on it.
 */
async function withoutLoader<T>(body: () => Promise<T>): Promise<T> {
  const holder = testEnv as unknown as Record<string, unknown>;
  const loader = holder.WIDGET_LOADER;
  delete holder.WIDGET_LOADER;
  try {
    return await body();
  } finally {
    holder.WIDGET_LOADER = loader;
  }
}

describe("a widget's built-in store", () => {
  it("keeps what a widget puts there, with no backend module and no server code", async () => {
    const { widget: one } = await plainWidget();

    // Nothing has been written, so the listing is empty rather than absent: a widget deciding
    // whether to show its first-run state should not have to tell 404 from "nothing yet".
    const empty = await SELF.fetch(storeUrl(one.url));
    expect(empty.status).toBe(200);
    expect(empty.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(await empty.json()).toEqual({ entries: [] });

    // A key nobody has written is a 404, which is the other half of that same distinction.
    expect((await SELF.fetch(storeUrl(one.url, "draft"))).status).toBe(404);

    const written = await put(storeUrl(one.url, "draft"), "hello");
    expect(written.status).toBe(200);
    expect(await written.json()).toEqual({ key: "draft", value: "hello" });

    const read = await SELF.fetch(storeUrl(one.url, "draft"));
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual({ key: "draft", value: "hello" });

    // Replacing a value is the same call again, so a widget does not have to know whether the key
    // is already there.
    await put(storeUrl(one.url, "draft"), "hello again");
    expect(await (await SELF.fetch(storeUrl(one.url, "draft"))).json())
      .toEqual({ key: "draft", value: "hello again" });

    const removed = await SELF.fetch(storeUrl(one.url, "draft"), { method: "DELETE" });
    expect(removed.status).toBe(204);
    expect((await SELF.fetch(storeUrl(one.url, "draft"))).status).toBe(404);
    // Idempotent: a widget retrying after a dropped connection gets the first attempt's answer.
    expect((await SELF.fetch(storeUrl(one.url, "draft"), { method: "DELETE" })).status).toBe(204);
  });

  it("stores the body verbatim, so a widget gets back exactly the string it sent", async () => {
    const { widget: one } = await plainWidget();
    // The shapes a widget actually PUTs: its own JSON, with no envelope this route might unwrap,
    // and text that is not JSON at all.
    const values = [
      JSON.stringify({ items: ["a", "b"], done: false }),
      '{"value":"not unwrapped"}',
      "plain text, ünïcode and all",
      "",
    ];
    for (const [index, value] of values.entries()) {
      await put(storeUrl(one.url, `k${index}`), value, {
        headers: { "content-type": "application/json" },
      });
      expect(await (await SELF.fetch(storeUrl(one.url, `k${index}`))).json())
        .toEqual({ key: `k${index}`, value });
    }
    // Including the empty string, which is a value and not an absence.
    expect((await SELF.fetch(storeUrl(one.url, "k3"))).status).toBe(200);
  });

  it("lists in key order, and narrows by prefix and limit", async () => {
    const { widget: one } = await plainWidget();
    for (const key of ["note/b", "note/a", "other"]) await put(storeUrl(one.url, key), key);

    expect(await (await SELF.fetch(storeUrl(one.url))).json()).toEqual({
      entries: [
        { key: "note/a", value: "note/a" },
        { key: "note/b", value: "note/b" },
        { key: "other", value: "other" },
      ],
    });
    // A slash in a key is just a character, which is what lets a widget namespace its own keys.
    expect(await (await SELF.fetch(`${storeUrl(one.url)}?prefix=note/`)).json()).toEqual({
      entries: [
        { key: "note/a", value: "note/a" },
        { key: "note/b", value: "note/b" },
      ],
    });
    expect(await (await SELF.fetch(`${storeUrl(one.url)}?prefix=note/&limit=1`)).json())
      .toEqual({ entries: [{ key: "note/a", value: "note/a" }] });
    // Percent-encoded and literal reach the same key, so a widget may build its URLs either way.
    expect(await (await SELF.fetch(storeUrl(one.url, "note%2Fa"))).json())
      .toEqual({ key: "note/a", value: "note/a" });

    expect((await SELF.fetch(`${storeUrl(one.url)}?limit=nonsense`)).status).toBe(400);
  });

  it("refuses a value bigger than a widget's store holds", async () => {
    const { widget: one } = await plainWidget();
    const answer = await put(storeUrl(one.url, "big"), "x".repeat(MAX_VALUE_BYTES + 1));
    expect(answer.status).toBe(413);
    expect((await answer.json() as { error: string }).error).toMatch(/at most 131072/);
    // Refused rather than truncated: nothing was stored.
    expect((await SELF.fetch(storeUrl(one.url, "big"))).status).toBe(404);

    // And the largest value it does hold goes in.
    expect((await put(storeUrl(one.url, "big"), "x".repeat(MAX_VALUE_BYTES))).status).toBe(200);
  });

  it("answers only its own routes, and only the methods each one has", async () => {
    const { widget: one } = await plainWidget();

    // The listing is read-only; a change addresses a key.
    const posted = await SELF.fetch(storeUrl(one.url), { method: "POST", body: "x" });
    expect(posted.status).toBe(405);
    expect(posted.headers.get("allow")).toBe("GET, HEAD");
    const patched = await SELF.fetch(storeUrl(one.url, "k"), { method: "PATCH", body: "x" });
    expect(patched.status).toBe(405);
    expect(patched.headers.get("allow")).toBe("GET, HEAD, PUT, DELETE");

    // A key is required, rather than `api/store/` quietly meaning the listing.
    expect((await SELF.fetch(`${storeUrl(one.url)}/`)).status).toBe(400);

    // Everything else under api/ is nobody's to answer, and says so by naming what is.
    const elsewhere = await SELF.fetch(`${one.url}api/notes`);
    expect(elsewhere.status).toBe(404);
    expect(await elsewhere.text()).toMatch(/has no backend\.js.*api\/store/s);
    expect((await SELF.fetch(`${one.url}api/`)).status).toBe(404);
    // Not a store either: a key that starts with the prefix is not the prefix.
    expect((await SELF.fetch(`${one.url}api/storefront`)).status).toBe(404);
  });

  it("answers as data, under the same policy and cookie rules as a backend would", async () => {
    const { store, widget: one } = await plainWidget({ visibility: "project" });

    // The frontend names api/ in its own connect-src, which is the address this route sits under.
    const cookie = cookieOf(
      await SELF.fetch((await store.mintWidgetLink(bob.memberId, one.widgetId)).url));
    const page = await SELF.fetch(one.url, { headers: { cookie } });
    expect(page.headers.get("content-security-policy")).toContain(`connect-src 'self' ${one.url}api/`);

    const answer = await put(storeUrl(one.url, "note"), "kept", { headers: { cookie } });
    expect(answer.status).toBe(200);
    // Data for the widget's own script, never a document this origin should render.
    expect(answer.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(answer.headers.get("x-content-type-options")).toBe("nosniff");
    expect(answer.headers.get("cache-control")).toBe("private, no-store");
    // And the capability slides forward on every answer, exactly as it does on the frontend.
    expect(answer.headers.get("set-cookie")).toContain(`pw_${one.widgetId}=`);
    expect(answer.headers.get("set-cookie")).toContain("HttpOnly");

    // The renewed cookie is what the next request uses, and it works.
    expect((await SELF.fetch(storeUrl(one.url, "note"), { headers: { cookie: cookieOf(answer) } }))
      .status).toBe(200);
  });
});

describe("who may reach a widget's store", () => {
  it("lets a member in with a capability, and nobody in without one", async () => {
    const { store, widget: one } = await plainWidget({ visibility: "project" });

    // A project widget is not a public one, and its store is not a way around that.
    expect((await SELF.fetch(storeUrl(one.url))).status).toBe(404);
    expect((await put(storeUrl(one.url, "note"), "sneaked")).status).toBe(404);
    expect((await SELF.fetch(storeUrl(one.url, "note"), { method: "DELETE" })).status).toBe(404);

    const cookie = cookieOf(
      await SELF.fetch((await store.mintWidgetLink(bob.memberId, one.widgetId)).url));
    expect((await put(storeUrl(one.url, "note"), "kept", { headers: { cookie } })).status).toBe(200);

    // Nothing landed from the refused writes: the widget's store holds only Bob's key.
    expect(await (await SELF.fetch(storeUrl(one.url), { headers: { cookie } })).json())
      .toEqual({ entries: [{ key: "note", value: "kept" }] });
  });

  it("closes a browser that already had the store open when sharing stops", async () => {
    const { store, widget: one } = await plainWidget({ visibility: "project" });
    const cookie = cookieOf(
      await SELF.fetch((await store.mintWidgetLink(bob.memberId, one.widgetId)).url));
    await put(storeUrl(one.url, "note"), "kept", { headers: { cookie } });

    await store.setWidgetVisibility(alice.memberId, one.widgetId, "private");
    // The cookie is still perfectly well signed and has not expired. What changed is the answer
    // behind it, and that answer is worked out again on every single request.
    expect((await SELF.fetch(storeUrl(one.url, "note"), { headers: { cookie } })).status).toBe(404);

    // Removing the member does the same, to a capability that is otherwise still good.
    await store.setWidgetVisibility(alice.memberId, one.widgetId, "project");
    expect((await SELF.fetch(storeUrl(one.url, "note"), { headers: { cookie } })).status).toBe(200);
    await store.removeMember(alice.memberId, bob.memberId);
    expect((await SELF.fetch(storeUrl(one.url, "note"), { headers: { cookie } })).status).toBe(404);
  });

  it("opens a public widget's store to anyone who can open the widget, and no longer", async () => {
    const { store, widget: one } = await plainWidget({ visibility: "public" });

    // The same rule a public backend would have had: whoever can open the widget can reach what it
    // remembers. Publishing a widget publishes its store.
    expect((await put(storeUrl(one.url, "score"), "10")).status).toBe(200);
    expect(await (await SELF.fetch(storeUrl(one.url, "score"))).json())
      .toEqual({ key: "score", value: "10" });
    // Nothing to renew: a stranger with a public link has no session to slide forward.
    expect((await SELF.fetch(storeUrl(one.url, "score"))).headers.get("set-cookie")).toBe(null);

    await store.setWidgetVisibility(alice.memberId, one.widgetId, "project");
    expect((await SELF.fetch(storeUrl(one.url, "score"))).status).toBe(404);
    expect((await put(storeUrl(one.url, "score"), "20")).status).toBe(404);
  });

  it("gives each widget a store of its own, and will not cross between them", async () => {
    const { store, projectId } = await project();
    const [mine, other] = await Promise.all([
      widget(store, { path: "shared/first", name: "First", visibility: "public" }),
      widget(store, { path: "shared/second", name: "Second", visibility: "public" }),
    ]);
    for (const one of [mine, other]) {
      await writeWidgetFile(store, {
        widgetId: one.widgetId, path: "index.html", content: `<h1>${one.name}</h1>`,
      });
    }

    await put(storeUrl(mine.url, "note"), "first");
    await put(storeUrl(other.url, "note"), "second");
    // The same key in both, because they are not the same object: the store is named by project
    // and widget together and there is no name a caller could ask for instead.
    expect(await (await SELF.fetch(storeUrl(mine.url, "note"))).json())
      .toMatchObject({ value: "first" });
    expect(await (await SELF.fetch(storeUrl(other.url, "note"))).json())
      .toMatchObject({ value: "second" });
    expect(await (await SELF.fetch(storeUrl(mine.url))).json())
      .toEqual({ entries: [{ key: "note", value: "first" }] });

    // And a capability for one widget is not a capability for the other's store, even offered
    // under the cookie name the other widget's own requests would carry.
    const shared = await widget(store, { path: "alice/private", name: "Private" });
    await writeWidgetFile(store, {
      widgetId: shared.widgetId, path: "index.html", content: "<h1>private</h1>",
    });
    const token = cookieOf(
      await SELF.fetch((await store.mintWidgetLink(alice.memberId, shared.widgetId)).url))
      .split("=")[1];
    const moved = await SELF.fetch(storeUrl(mine.url, "note"), {
      headers: { cookie: `pw_${mine.widgetId}=${token}` },
    });
    // Public, so it opens anyway -- but as a stranger, on the public widget's own terms, with the
    // borrowed capability counting for nothing.
    expect(moved.headers.get("set-cookie")).toBe(null);
    expect((await SELF.fetch(storeUrl(shared.url, "note"),
      { headers: { cookie: `pw_${shared.widgetId}=${token.slice(0, -1)}x` } })).status).toBe(404);
    // Nothing here is addressable by project id either: the store is not a project-wide namespace.
    expect((await SELF.fetch(
      `${testEnv.PUBLIC_BASE_URL}/gatekeeper/project/w/${projectId}/${mine.widgetId}` +
      `/api/store/../../${other.widgetId}/api/store/note`)).status).toBe(404);
  });

  it("holds nothing but what a widget put there: no configuration, no project files", async () => {
    const { store, projectId, widget: one } = await plainWidget({ visibility: "public" });
    await store.setEnvVar(alice.memberId, "API_TOKEN", "s3cret", "");
    const secret = await file(store, {
      path: "bob/secret.md",
      content: "bob's private notes",
      mimeType: "text/markdown",
      visibility: "private",
      memberId: bob.memberId,
    });

    // The project's shared configuration is what a backend runs with, and this is not a backend.
    // No route here hands it out, by name or otherwise.
    const listed = await SELF.fetch(storeUrl(one.url));
    expect(await listed.text()).toBe('{"entries":[]}');
    for (const key of ["API_TOKEN", secret.fileId, "../../env", "%2E%2E%2Fenv"]) {
      const answer = await SELF.fetch(storeUrl(one.url, key));
      expect(answer.status).toBe(404);
      const body = await answer.text();
      expect(body).not.toContain("s3cret");
      expect(body).not.toContain("bob's private notes");
    }

    // A key that happens to be named after a file is a key nobody wrote, and writing it changes
    // nothing outside the store.
    await put(storeUrl(one.url, secret.fileId), "overwritten?");
    expect((await SELF.fetch(fileUrl(testEnv, projectId, secret.fileId))).status).toBe(404);
  });
});

describe("a widget that has written a backend", () => {
  it("keeps the isolate, and its api/store is the backend's own", async () => {
    const { store, widget: one } = await plainWidget({ visibility: "public" });
    await writeWidgetFile(store, {
      widgetId: one.widgetId,
      path: "backend.js",
      mimeType: "text/javascript",
      content: `
        export default {
          async fetch(request, env) {
            const url = new URL(request.url);
            if (url.pathname === "/api/store") {
              await env.STORE.put("through-the-backend", "yes");
              return Response.json({ mine: true, keys: await env.STORE.list() });
            }
            return Response.json({ mine: true, path: url.pathname });
          },
        };
      `,
    });

    // The built-in route does not shadow a module that answers the same address: a widget with a
    // backend owns the whole of its api/, or its routes would depend on a file nobody can see.
    expect(await (await SELF.fetch(storeUrl(one.url))).json()).toEqual({
      mine: true,
      keys: [{ key: "through-the-backend", value: "yes" }],
    });
    // And the paths the built-in route refuses are the backend's to answer too.
    expect(await (await SELF.fetch(`${one.url}api/notes`)).json())
      .toEqual({ mine: true, path: "/api/notes" });

    // Same object either way: dropping the backend leaves what it wrote exactly where it was.
    await store.deleteWidgetFile(alice.memberId, one.widgetId, "backend.js");
    expect(await (await SELF.fetch(storeUrl(one.url))).json())
      .toEqual({ entries: [{ key: "through-the-backend", value: "yes" }] });
  });
});

describe("a deployment with no Worker Loader", () => {
  it("serves a widget's frontend and its whole store regardless", async () => {
    const { widget: one } = await plainWidget();
    await withoutLoader(async () => {
      expect(await (await SELF.fetch(one.url)).text()).toBe("<h1>notes</h1>");

      expect((await put(storeUrl(one.url, "note"), "kept")).status).toBe(200);
      expect(await (await SELF.fetch(storeUrl(one.url, "note"))).json())
        .toEqual({ key: "note", value: "kept" });
      expect(await (await SELF.fetch(storeUrl(one.url))).json())
        .toEqual({ entries: [{ key: "note", value: "kept" }] });
      expect((await SELF.fetch(storeUrl(one.url, "note"), { method: "DELETE" })).status).toBe(204);
      expect(await (await SELF.fetch(storeUrl(one.url))).json()).toEqual({ entries: [] });
    });
  });

  it("tells a widget with a backend module what is missing and what still works", async () => {
    const { store, widget: one } = await plainWidget();
    await writeWidgetFile(store, {
      widgetId: one.widgetId, path: "backend.js", mimeType: "text/javascript",
      content: "export default { async fetch() { return new Response('ran'); } };",
    });

    await withoutLoader(async () => {
      const answer = await SELF.fetch(`${one.url}api/anything`);
      expect(answer.status).toBe(501);
      const message = await answer.text();
      // A 501 is only useful if it names the thing that is absent and the thing that is not.
      expect(message).toMatch(/no Worker Loader binding/);
      expect(message).toMatch(/Dynamic Worker Loaders/);
      expect(message).toMatch(/api\/store/);

      // The frontend is untouched, which is the point: only the module is unavailable.
      expect((await SELF.fetch(one.url)).status).toBe(200);
    });

    // With the binding back, the same request runs the module.
    expect(await (await SELF.fetch(`${one.url}api/anything`)).text()).toBe("ran");
  });
});
