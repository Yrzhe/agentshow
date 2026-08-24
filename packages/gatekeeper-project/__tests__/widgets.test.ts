// A widget answers to the project's existing rules rather than to rules of its own, so what these
// suites check is that the answers really are the same ones: who may open a widget, who may change
// it, whose bytes it charges. And then the part that is new -- deciding all of that for an HTTP
// request that arrives with no member identity, from a capability that may have gone stale.

import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { newId } from "../src/model.js";
import type { ProjectDurableObject, StagedWidgetFile } from "../src/project-store.js";
import type { ProjectFileVisibility } from "../src/types.js";

const testEnv = env as unknown as {
  PROJECT_STORE: DurableObjectNamespace<ProjectDurableObject>;
  PROJECT_FILES: R2Bucket;
};

const alice = { memberId: "alice", displayName: "Alice" };
const bob = { memberId: "bob", displayName: "Bob" };
/** Someone who never joined, which is what a public widget's visitor looks like from in here. */
const outsider = "carol";

type Store = DurableObjectStub<ProjectDurableObject>;

/** See `store.test.ts`: adopting a stub's promise gives `expect` something ordinary to look at. */
function rpc<T>(call: Promise<T>): Promise<T> {
  return (async () => call)();
}

/** Alice's project with Bob in it, in a Durable Object no other test shares. */
async function projectWithBob(): Promise<{ store: Store; projectId: string }> {
  const projectId = newId();
  const store = testEnv.PROJECT_STORE.get(testEnv.PROJECT_STORE.idFromName(projectId));
  await store.initialize(projectId, "Launch", "", alice);
  const secret = newId();
  await store.commitInvite(alice.memberId, secret, "member", Date.now() + 60_000);
  await store.redeemInvite(secret, bob);
  return { store, projectId };
}

/** A widget, created through plan and commit the way the gatekeeper creates one. */
async function widget(store: Store, opts: {
  memberId?: string;
  path?: string;
  name?: string;
  visibility?: ProjectFileVisibility;
} = {}) {
  const memberId = opts.memberId ?? alice.memberId;
  const path = opts.path ?? "shared/dashboard";
  const plan = await store.planWidget(memberId, {
    path, ...(opts.visibility ? { visibility: opts.visibility } : {}),
  });
  return store.commitWidget(memberId, {
    widgetId: plan.widgetId,
    name: opts.name ?? "Dashboard",
    path,
    description: "",
    visibility: plan.visibility,
  });
}

/** One file into a widget, planned, staged and committed as the session layer does it. */
async function writeWidgetFile(store: Store, opts: {
  widgetId: string;
  path: string;
  content: string;
  mimeType?: string;
  memberId?: string;
}) {
  const memberId = opts.memberId ?? alice.memberId;
  const bytes = new TextEncoder().encode(opts.content);
  await store.planWidgetFile(memberId, opts.widgetId, {
    path: opts.path, size: bytes.byteLength,
  });
  const contentKey = newId();
  await testEnv.PROJECT_FILES.put(contentKey, bytes);
  const write: StagedWidgetFile = {
    widgetId: opts.widgetId,
    contentKey,
    path: opts.path,
    mimeType: opts.mimeType ?? "text/html",
    size: bytes.byteLength,
  };
  return store.commitWidgetFile(memberId, write);
}

/** The token out of a signed widget link, which is what a browser would carry back. */
function tokenOf(url: string): string {
  return new URL(url).searchParams.get("t")!;
}

describe("who can see a widget", () => {
  it("takes its visibility from its path, exactly as a file does", async () => {
    const { store } = await projectWithBob();
    const shared = await widget(store, { path: "shared/dashboard" });
    const own = await widget(store, { path: "alice/scratch", name: "Scratch" });

    expect(shared.visibility).toBe("project");
    expect(own.visibility).toBe("private");

    // Bob is a member, so the shared one is his to open and the private one is not there at all.
    expect((await store.listWidgets(bob.memberId, { limit: 10 })).map((one) => one.path))
      .toEqual(["shared/dashboard"]);
    await expect(rpc(store.statWidget(bob.memberId, own.widgetId))).rejects
      .toThrow(/does not exist, or is not shared with you/);
  });

  it("keeps a public widget public across a move, and follows the path otherwise", async () => {
    const { store } = await projectWithBob();
    const published = await widget(store, { path: "shared/site", visibility: "public" });
    const shared = await widget(store, { path: "shared/tool", name: "Tool" });

    // Publishing is deliberate enough that a rename must not quietly undo it.
    expect((await store.moveWidget(alice.memberId, published.widgetId, "alice/site")).visibility)
      .toBe("public");
    // Everything else reads its path as the intent, both ways.
    expect((await store.moveWidget(alice.memberId, shared.widgetId, "alice/tool")).visibility)
      .toBe("private");
    expect((await store.moveWidget(alice.memberId, shared.widgetId, "shared/tool")).visibility)
      .toBe("project");
  });

  it("refuses a path another widget or a file already holds", async () => {
    const { store } = await projectWithBob();
    await widget(store, { path: "shared/dashboard" });
    await expect(rpc(store.planWidget(alice.memberId, { path: "shared/dashboard" }))).rejects
      .toThrow(/already taken by another widget/);

    const bytes = new TextEncoder().encode("notes");
    const plan = await store.planWrite(alice.memberId, {
      path: "shared/notes", size: bytes.byteLength,
    });
    const contentKey = newId();
    await testEnv.PROJECT_FILES.put(contentKey, bytes);
    await store.commitWrite(alice.memberId, {
      fileId: plan.fileId, contentKey, path: "shared/notes", mimeType: "text/markdown",
      size: bytes.byteLength, visibility: plan.visibility, description: "", indexedText: "notes",
    });
    // A path in a project means one thing, so a widget may not stand where a file already does.
    await expect(rpc(store.planWidget(alice.memberId, { path: "shared/notes" }))).rejects
      .toThrow(/already taken by a file/);
  });
});

describe("who can change a widget", () => {
  it("lets only the owner write its files, and points elsewhere when it refuses", async () => {
    const { store } = await projectWithBob();
    const shared = await widget(store, { path: "shared/dashboard" });
    await writeWidgetFile(store, {
      widgetId: shared.widgetId, path: "index.html", content: "<h1>hi</h1>",
    });

    // Bob can read every file of a widget shared with the project.
    expect(await store.listWidgetFiles(bob.memberId, shared.widgetId))
      .toMatchObject([{ path: "index.html", mimeType: "text/html" }]);
    await expect(rpc(store.readWidgetFile(bob.memberId, shared.widgetId, "index.html")))
      .resolves.toMatchObject({ content: "<h1>hi</h1>" });

    // And none of them are his to overwrite, project owner or not.
    await expect(rpc(writeWidgetFile(store, {
      widgetId: shared.widgetId, path: "index.html", content: "<h1>mine</h1>",
      memberId: bob.memberId,
    }))).rejects.toThrow(/belongs to another member and only its owner can change it/);
    await expect(rpc(store.setWidgetVisibility(bob.memberId, shared.widgetId, "public"))).rejects
      .toThrow(/only its owner can change it/);
    await expect(rpc(store.moveWidget(bob.memberId, shared.widgetId, "bob/dashboard"))).rejects
      .toThrow(/only its owner can change it/);
  });

  it("lets a project owner delete somebody else's widget, to moderate", async () => {
    const { store } = await projectWithBob();
    const bobs = await widget(store, {
      memberId: bob.memberId, path: "shared/bobs-app", name: "Bob's app",
    });
    await writeWidgetFile(store, {
      widgetId: bobs.widgetId, path: "index.html", content: "<h1>bob</h1>",
      memberId: bob.memberId,
    });

    // Alice cannot rewrite it -- but somebody has to be able to clear the room.
    await expect(rpc(writeWidgetFile(store, {
      widgetId: bobs.widgetId, path: "index.html", content: "<h1>alice</h1>",
    }))).rejects.toThrow(/only its owner can change it/);
    expect(await store.deleteWidget(alice.memberId, bobs.widgetId)).toEqual({ deleted: true });
    expect(await store.listWidgets(bob.memberId, { limit: 10 })).toEqual([]);
    // Reported so the caller knows whether to throw away the widget's own store as well.
    expect(await store.deleteWidget(alice.memberId, bobs.widgetId)).toEqual({ deleted: false });
  });

  it("refuses a member's widget to somebody who is not in the project at all", async () => {
    const { store } = await projectWithBob();
    const shared = await widget(store, { path: "shared/dashboard" });
    await expect(rpc(store.statWidget(outsider, shared.widgetId))).rejects
      .toThrow(/does not exist, or is not shared with you/);
    await expect(rpc(store.listWidgets(outsider, { limit: 10 }))).rejects
      .toThrow(/That project does not exist/);
  });
});

describe("opening a widget over HTTP", () => {
  it("serves a public widget with no capability at all, until it stops being public", async () => {
    const { store } = await projectWithBob();
    const published = await widget(store, { path: "shared/site", visibility: "public" });
    await writeWidgetFile(store, {
      widgetId: published.widgetId, path: "index.html", content: "<h1>open</h1>",
    });

    // No member id and no token: this is a stranger with the link, which is what public means.
    const open = await store.fetchWidgetAsset(published.widgetId, [], "");
    expect(open).toMatchObject({ ok: true, principal: { kind: "public" } });
    expect(open.ok && new TextDecoder().decode(open.bytes)).toBe("<h1>open</h1>");
    // Nothing to renew: a public widget's link is stable because there is nothing in it to expire.
    expect(open.ok && open.renewedToken).toBeUndefined();
    expect(await store.mintWidgetLink(alice.memberId, published.widgetId))
      .toEqual({ url: expect.stringContaining(published.widgetId), expires: null });

    // And the moment its owner takes it back, the same request is a stranger's again.
    await store.setWidgetVisibility(alice.memberId, published.widgetId, "project");
    expect(await store.fetchWidgetAsset(published.widgetId, [], ""))
      .toMatchObject({ ok: false, status: 404 });
  });

  it("serves a project widget to a member's token, and to nobody without one", async () => {
    const { store } = await projectWithBob();
    const shared = await widget(store, { path: "shared/dashboard" });
    await writeWidgetFile(store, {
      widgetId: shared.widgetId, path: "index.html", content: "<h1>members</h1>",
    });

    expect(await store.fetchWidgetAsset(shared.widgetId, [], ""))
      .toMatchObject({ ok: false, status: 404 });

    const link = await store.mintWidgetLink(bob.memberId, shared.widgetId);
    expect(link.expires).not.toBe(null);
    const opened = await store.fetchWidgetAsset(shared.widgetId, [tokenOf(link.url)], "");
    expect(opened).toMatchObject({
      ok: true,
      principal: { kind: "member", memberId: "bob", role: "member" },
    });
    // A fresh capability with every answer, which is what lets the cookie slide while the check
    // behind it is redone from scratch each time.
    expect(opened.ok && opened.renewedToken).toBeTypeOf("string");
    expect(opened.ok && opened.renewedToken).not.toBe(tokenOf(link.url));

    // Alice sees herself as the owner, from a token of her own.
    const owner = await store.mintWidgetLink(alice.memberId, shared.widgetId);
    expect(await store.fetchWidgetAsset(shared.widgetId, [tokenOf(owner.url)], ""))
      .toMatchObject({ principal: { kind: "member", memberId: "alice", role: "owner" } });
  });

  it("stops honouring a capability the moment the widget stops being shared", async () => {
    const { store } = await projectWithBob();
    const shared = await widget(store, { path: "shared/dashboard" });
    await writeWidgetFile(store, {
      widgetId: shared.widgetId, path: "index.html", content: "<h1>members</h1>",
    });
    const token = tokenOf((await store.mintWidgetLink(bob.memberId, shared.widgetId)).url);
    expect(await store.fetchWidgetAsset(shared.widgetId, [token], "")).toMatchObject({ ok: true });

    // The whole reason the decision is made per request rather than once at link time.
    await store.setWidgetVisibility(alice.memberId, shared.widgetId, "private");
    expect(await store.fetchWidgetAsset(shared.widgetId, [token], ""))
      .toMatchObject({ ok: false, status: 404 });

    // Removing Bob does the same thing to a token that is still perfectly well signed.
    await store.setWidgetVisibility(alice.memberId, shared.widgetId, "project");
    expect(await store.fetchWidgetAsset(shared.widgetId, [token], "")).toMatchObject({ ok: true });
    await store.removeMember(alice.memberId, bob.memberId);
    expect(await store.fetchWidgetAsset(shared.widgetId, [token], ""))
      .toMatchObject({ ok: false, status: 404 });
  });

  it("will not let one widget's capability open another", async () => {
    const { store } = await projectWithBob();
    const mine = await widget(store, { path: "shared/dashboard" });
    const other = await widget(store, { path: "shared/other", name: "Other" });
    for (const one of [mine, other]) {
      await writeWidgetFile(store, {
        widgetId: one.widgetId, path: "index.html", content: `<h1>${one.name}</h1>`,
      });
    }

    const token = tokenOf((await store.mintWidgetLink(bob.memberId, mine.widgetId)).url);
    // Both were signed with the same project key, so the widget id inside the payload is the only
    // thing keeping them apart -- which is exactly what is being checked.
    expect(await store.fetchWidgetAsset(other.widgetId, [token], ""))
      .toMatchObject({ ok: false, status: 404 });
    expect(await store.fetchWidgetAsset(mine.widgetId, [token], "")).toMatchObject({ ok: true });
  });

  it("takes the capability that works when a stale one is offered beside it", async () => {
    const { store } = await projectWithBob();
    const shared = await widget(store, { path: "shared/dashboard" });
    await writeWidgetFile(store, {
      widgetId: shared.widgetId, path: "index.html", content: "<h1>members</h1>",
    });
    const good = tokenOf((await store.mintWidgetLink(bob.memberId, shared.widgetId)).url);

    // A tab left open past its expiry has the stale token in its address bar and a current cookie
    // beside it, so both are offered and the answer has to come from whichever one still holds.
    expect(await store.fetchWidgetAsset(shared.widgetId, ["nonsense.1.deadbeef", good], ""))
      .toMatchObject({ ok: true, principal: { kind: "member", memberId: "bob" } });
    expect(await store.fetchWidgetAsset(shared.widgetId, ["nonsense.1.deadbeef"], ""))
      .toMatchObject({ ok: false, status: 404 });
  });

  it("resolves the widget's root to its index, and never serves its backend", async () => {
    const { store } = await projectWithBob();
    const published = await widget(store, { path: "shared/site", visibility: "public" });
    await writeWidgetFile(store, {
      widgetId: published.widgetId, path: "index.html", content: "<h1>site</h1>",
    });
    await writeWidgetFile(store, {
      widgetId: published.widgetId, path: "backend.js", content: "export default {};",
      mimeType: "text/javascript",
    });

    expect(await store.fetchWidgetAsset(published.widgetId, [], ""))
      .toMatchObject({ ok: true, path: "index.html" });
    // Asking for it by name gets nothing: the module's source is not an asset, and whatever its
    // author inlined in it is not published with the widget.
    expect(await store.fetchWidgetAsset(published.widgetId, [], "backend.js"))
      .toMatchObject({ ok: false, status: 404 });
    expect(await store.fetchWidgetAsset(published.widgetId, [], "missing.js"))
      .toMatchObject({ ok: false, status: 404 });
  });
});

describe("what answers under a widget's api/", () => {
  it("hands a backend the project's configuration, its own identity and the caller", async () => {
    const { store, projectId } = await projectWithBob();
    const shared = await widget(store, { path: "shared/dashboard" });
    await store.setEnvVar(alice.memberId, "GREETING", "hello", "");
    await writeWidgetFile(store, {
      widgetId: shared.widgetId, path: "backend.js", content: "export default {};",
      mimeType: "text/javascript",
    });

    const token = tokenOf((await store.mintWidgetLink(bob.memberId, shared.widgetId)).url);
    const opened = await store.openWidgetApi(shared.widgetId, [token]);
    expect(opened).toMatchObject({
      ok: true,
      projectId,
      widgetId: shared.widgetId,
      principal: { kind: "member", memberId: "bob", role: "member" },
      backend: {
        source: "export default {};",
        // Values, not just names: shared configuration is what makes a widget run for everybody.
        envVars: { GREETING: "hello" },
      },
    });
  });

  it("changes a backend's revision when the module or the configuration does", async () => {
    const { store } = await projectWithBob();
    const published = await widget(store, { path: "shared/site", visibility: "public" });
    await writeWidgetFile(store, {
      widgetId: published.widgetId, path: "backend.js", content: "export default { a: 1 };",
      mimeType: "text/javascript",
    });
    const first = await store.openWidgetApi(published.widgetId, []);

    await store.setEnvVar(alice.memberId, "TOKEN", "one", "");
    const configured = await store.openWidgetApi(published.widgetId, []);
    // The revision names the isolate, so a value the backend reads changing has to change it too --
    // otherwise a running isolate would keep answering with the old one.
    expect(configured.ok && configured.backend?.revision)
      .not.toBe(first.ok && first.backend?.revision);

    await writeWidgetFile(store, {
      widgetId: published.widgetId, path: "backend.js", content: "export default { a: 2 };",
      mimeType: "text/javascript",
    });
    const rewritten = await store.openWidgetApi(published.widgetId, []);
    expect(rewritten.ok && rewritten.backend?.revision)
      .not.toBe(configured.ok && configured.backend?.revision);
  });

  it("reports no backend for a widget without one, and reads no configuration for it", async () => {
    const { store } = await projectWithBob();
    const shared = await widget(store, { path: "shared/dashboard" });
    await store.setEnvVar(alice.memberId, "API_TOKEN", "s3cret", "");

    // A widget with no module of its own still opens: its `api/` is answered by its built-in
    // store, which the Worker serves itself. What it does not get is an environment -- the shared
    // configuration a backend runs with is read only when there is a backend to run.
    const token = tokenOf((await store.mintWidgetLink(bob.memberId, shared.widgetId)).url);
    const opened = await store.openWidgetApi(shared.widgetId, [token]);
    expect(opened).toMatchObject({
      ok: true,
      widgetId: shared.widgetId,
      principal: { kind: "member", memberId: "bob", role: "member" },
      backend: null,
    });
    expect(JSON.stringify(opened)).not.toContain("s3cret");
  });

  it("refuses api/ altogether to a caller who cannot open the widget", async () => {
    const { store } = await projectWithBob();
    const shared = await widget(store, { path: "shared/dashboard" });
    await writeWidgetFile(store, {
      widgetId: shared.widgetId, path: "backend.js", content: "export default {};",
      mimeType: "text/javascript",
    });

    // No capability at all. Nothing about the widget is admitted, so neither is the fact that it
    // has a backend or a store.
    expect(await store.openWidgetApi(shared.widgetId, []))
      .toMatchObject({ ok: false, status: 404 });
    expect(await store.openWidgetApi(shared.widgetId, ["nonsense.1.deadbeef"]))
      .toMatchObject({ ok: false, status: 404 });
  });
});

describe("what a widget costs", () => {
  it("charges its bytes to the project's quota, alongside its files", async () => {
    const { store } = await projectWithBob();
    const own = await widget(store, { path: "alice/big" });

    // The suite's quota is 4096 bytes a file and 8192 a project; see vitest.config.ts.
    await expect(rpc(writeWidgetFile(store, {
      widgetId: own.widgetId, path: "index.html", content: "x".repeat(5000),
    }))).rejects.toThrow(/this deployment allows at most 4096/);

    await writeWidgetFile(store, {
      widgetId: own.widgetId, path: "index.html", content: "x".repeat(4000),
    });
    await writeWidgetFile(store, {
      widgetId: own.widgetId, path: "app.js", content: "x".repeat(4000), mimeType: "text/javascript",
    });

    // One allowance, not one each: a widget's bytes are the deployment's bytes.
    await expect(rpc(writeWidgetFile(store, {
      widgetId: own.widgetId, path: "extra.css", content: "x".repeat(1000), mimeType: "text/css",
    }))).rejects.toThrow(/allowed bytes/);
    const bytes = new TextEncoder().encode("x".repeat(1000));
    await expect(rpc(store.planWrite(alice.memberId, {
      path: "alice/notes.md", size: bytes.byteLength,
    }))).rejects.toThrow(/allowed bytes/);

    // Replacing one of the widget's own files pays only the difference, exactly as a file does.
    await writeWidgetFile(store, {
      widgetId: own.widgetId, path: "app.js", content: "y".repeat(4000), mimeType: "text/javascript",
    });
    expect(await store.statWidget(alice.memberId, own.widgetId))
      .toMatchObject({ fileCount: 2, size: 8000 });
  });

  it("releases the bytes when the widget goes", async () => {
    const { store } = await projectWithBob();
    const own = await widget(store, { path: "alice/app" });
    await writeWidgetFile(store, {
      widgetId: own.widgetId, path: "index.html", content: "x".repeat(4000),
    });
    await store.deleteWidget(alice.memberId, own.widgetId);
    // The project is empty again, so a file that could not have fitted before now can.
    const bytes = new TextEncoder().encode("x".repeat(4000));
    await expect(rpc(store.planWrite(alice.memberId, {
      path: "alice/notes.md", size: bytes.byteLength,
    }))).resolves.toMatchObject({ visibility: "private" });
  });
});

describe("observing a widget", () => {
  it("answers against the widget's visibility right now", async () => {
    const { store, projectId } = await projectWithBob();
    const shared = await widget(store, { path: "shared/dashboard" });
    const own = await widget(store, { path: "alice/scratch", name: "Scratch" });
    const set = `w:${projectId}:${shared.widgetId}`;

    expect(await store.canObserve(bob.memberId, set)).toBe(true);
    expect(await store.canObserve(bob.memberId, `w:${projectId}:${own.widgetId}`)).toBe(false);
    expect(await store.canObserve(outsider, set)).toBe(false);

    // The point of re-checking: a collaborator who passed while the widget was shared does not pass
    // once its owner takes it back.
    await store.setWidgetVisibility(alice.memberId, shared.widgetId, "private");
    expect(await store.canObserve(bob.memberId, set)).toBe(false);
    expect(await store.canObserve(bob.memberId, `w:${projectId}:${newId()}`)).toBe(false);
  });
});
