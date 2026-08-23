// The project Durable Object is the whole authorization boundary for a project: it is handed a
// member id and answers only what that member may see. These suites ask it the questions a
// misbehaving gatekeeper facet would -- reading someone else's private file, overwriting their
// work, reading a comment thread from outside the project -- and check that it declines.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { newId } from "../src/model.js";
import type { ProjectDurableObject, StagedWrite } from "../src/project-store.js";
import type { ProjectFileVisibility } from "../src/types.js";

const testEnv = env as unknown as {
  PROJECT_STORE: DurableObjectNamespace<ProjectDurableObject>;
  PROJECT_FILES: R2Bucket;
};

const alice = { memberId: "alice", displayName: "Alice" };
const bob = { memberId: "bob", displayName: "Bob" };
/** Someone who never joined. Their id is as good as anyone's, which is the point of asking. */
const outsider = "carol";

type Store = DurableObjectStub<ProjectDurableObject>;

/**
 * An ordinary promise for a Durable Object call.
 *
 * `expect()` inspects whatever it is handed, and a stub's returned promise is also a pipelining
 * proxy: each property read on it dispatches a further call, which fails the same way with nobody
 * waiting on it. Adopting it first gives `expect` something ordinary to look at.
 */
function rpc<T>(call: Promise<T>): Promise<T> {
  return (async () => call)();
}

/** A fresh project with Alice as owner, in a Durable Object no other test shares. */
async function newProject(): Promise<{ store: Store; projectId: string }> {
  const projectId = newId();
  const store = testEnv.PROJECT_STORE.get(testEnv.PROJECT_STORE.idFromName(projectId));
  await store.initialize(projectId, "Launch", "The launch project", alice);
  return { store, projectId };
}

/** Alice's project with Bob in it, joined through a real invite. */
async function projectWithBob(): Promise<{ store: Store; projectId: string }> {
  const project = await newProject();
  const secret = newId();
  await project.store.commitInvite(alice.memberId, secret, "member", Date.now() + 60_000);
  await project.store.redeemInvite(secret, bob);
  return project;
}

/**
 * Write a file the way the gatekeeper does: plan it, put the bytes in R2, then commit.
 *
 * Going through both halves rather than inserting a row keeps these suites honest about the split --
 * `planWrite` is the answer the agent gets, `commitWrite` is the gate that actually holds.
 */
async function write(
  store: Store,
  memberId: string,
  path: string,
  content: string,
  opts: { visibility?: ProjectFileVisibility; fileId?: string; skillName?: string } = {},
) {
  const bytes = new TextEncoder().encode(content);
  const plan = await store.planWrite(memberId, {
    path, fileId: opts.fileId, size: bytes.byteLength, visibility: opts.visibility,
  });
  const contentKey = newId();
  await testEnv.PROJECT_FILES.put(contentKey, bytes);
  const staged: StagedWrite = {
    fileId: plan.fileId,
    contentKey,
    path,
    mimeType: "text/markdown",
    size: bytes.byteLength,
    visibility: plan.visibility,
    description: "",
    indexedText: content,
    ...(opts.skillName ? { skillName: opts.skillName } : {}),
  };
  return store.commitWrite(memberId, staged);
}

describe("membership", () => {
  it("makes the creator an owner and nobody else a member", async () => {
    const { store } = await newProject();
    await expect(rpc(store.summaryFor(alice.memberId))).resolves.toMatchObject({
      name: "Launch", role: "owner", memberCount: 1,
    });
    await expect(rpc(store.summaryFor(bob.memberId))).resolves.toBe(null);
    await expect(rpc(store.isMember(outsider))).resolves.toBe(false);
  });

  it("refuses to create the same project twice", async () => {
    const { store, projectId } = await newProject();
    await expect(rpc(store.initialize(projectId, "Other", "", bob)))
      .rejects.toThrow(/already exists/);
  });

  it("answers nothing at all to a non-member", async () => {
    const { store } = await newProject();
    await expect(rpc(store.listMembers(outsider))).rejects.toThrow();
    await expect(rpc(store.listFiles(outsider, { limit: 10 }))).rejects.toThrow();
    await expect(rpc(store.listComments(outsider))).rejects.toThrow();
    await expect(rpc(store.listEnvVars(outsider))).rejects.toThrow();
  });

  it("lets only an owner invite", async () => {
    const { store } = await projectWithBob();
    await expect(rpc(store.planInvite(alice.memberId))).resolves.toBeUndefined();
    await expect(rpc(store.planInvite(bob.memberId))).rejects.toThrow(/owner/);
    await expect(rpc(store.planInvite(outsider))).rejects.toThrow();
  });

  it("adds the member the invite named, and records the name they chose", async () => {
    const { store } = await projectWithBob();
    const members = await store.listMembers(alice.memberId);
    expect(members.map((member) => member.displayName).toSorted()).toEqual(["Alice", "Bob"]);
    expect(members.find((member) => member.memberId === "bob")!.role).toBe("member");
  });

  it("treats redeeming twice as joining once", async () => {
    const { store } = await newProject();
    const secret = newId();
    await store.commitInvite(alice.memberId, secret, "member", Date.now() + 60_000);
    await store.redeemInvite(secret, bob);
    await expect(rpc(store.redeemInvite(secret, bob))).resolves.toMatchObject({ role: "member" });
    expect(await store.listMembers(alice.memberId)).toHaveLength(2);
  });

  it("refuses an expired, a revoked, and an unknown code", async () => {
    const { store } = await newProject();
    const expired = newId();
    await store.commitInvite(alice.memberId, expired, "member", Date.now() - 1);
    await expect(rpc(store.redeemInvite(expired, bob))).rejects.toThrow(/expired/);

    const revoked = newId();
    await store.commitInvite(alice.memberId, revoked, "member", Date.now() + 60_000);
    await store.revokeInvite(revoked);
    await expect(rpc(store.redeemInvite(revoked, bob))).rejects.toThrow(/not valid/);

    await expect(rpc(store.redeemInvite(newId(), bob))).rejects.toThrow(/not valid/);
  });

  it("keeps a removed member's shared work and takes away their access", async () => {
    const { store } = await projectWithBob();
    const shared = await write(store, bob.memberId, "shared/bob.md", "Bob's notes");
    const priv = await write(store, bob.memberId, "bob/private.md", "secret");

    await expect(rpc(store.removeMember(bob.memberId, alice.memberId))).rejects.toThrow(/owner/);
    await expect(rpc(store.removeMember(alice.memberId, alice.memberId)))
      .rejects.toThrow(/themselves/);
    await store.removeMember(alice.memberId, bob.memberId);

    await expect(rpc(store.isMember(bob.memberId))).resolves.toBe(false);
    await expect(rpc(store.readFile(bob.memberId, shared.fileId))).rejects.toThrow();
    // The shared file survives, still under Bob's name; his private one is now unreachable.
    const remaining = await store.listFiles(alice.memberId, { limit: 10 });
    expect(remaining.map((file) => file.path)).toEqual(["shared/bob.md"]);
    expect(remaining[0].ownerId).toBe("bob");
    await expect(rpc(store.readFile(alice.memberId, priv.fileId))).rejects.toThrow();
  });
});

describe("file visibility", () => {
  it("shows a member their own files and everything shared with the project", async () => {
    const { store } = await projectWithBob();
    await write(store, alice.memberId, "alice/draft.md", "draft");
    await write(store, alice.memberId, "shared/plan.md", "plan");
    await write(store, bob.memberId, "bob/draft.md", "bob draft");

    const forBob = await store.listFiles(bob.memberId, { limit: 10 });
    expect(forBob.map((file) => file.path).toSorted()).toEqual(["bob/draft.md", "shared/plan.md"]);
    const forAlice = await store.listFiles(alice.memberId, { limit: 10 });
    expect(forAlice.map((file) => file.path).toSorted())
      .toEqual(["alice/draft.md", "shared/plan.md"]);
  });

  it("takes a shared/ path as the intent to share, with no flag passed", async () => {
    const { store } = await projectWithBob();
    const shared = await write(store, alice.memberId, "shared/plan.md", "plan");
    const own = await write(store, alice.memberId, "alice/draft.md", "draft");
    expect(shared.visibility).toBe("project");
    expect(own.visibility).toBe("private");
  });

  it("keeps a private file out of another member's reads and searches", async () => {
    const { store } = await projectWithBob();
    const secret =
      await write(store, alice.memberId, "alice/secret.md", "the codeword is swordfish");

    await expect(rpc(store.readFile(bob.memberId, secret.fileId))).rejects.toThrow();
    await expect(rpc(store.statFile(bob.memberId, secret.fileId))).rejects.toThrow();
    await expect(rpc(store.mintLink(bob.memberId, secret.fileId))).rejects.toThrow();
    await expect(rpc(store.searchFiles(bob.memberId, "swordfish", 10))).resolves.toEqual([]);
    // ...and the owner still finds it, so the check is about the reader, not the indexing.
    await expect(rpc(store.searchFiles(alice.memberId, "swordfish", 10))).resolves.toHaveLength(1);
  });

  it("moves visibility with the path, in both directions", async () => {
    const { store } = await projectWithBob();
    const file = await write(store, alice.memberId, "alice/draft.md", "draft");
    expect(file.visibility).toBe("private");

    const shared = await store.moveFile(alice.memberId, file.fileId, "shared/draft.md");
    expect(shared.visibility).toBe("project");
    await expect(rpc(store.readFile(bob.memberId, file.fileId))).resolves.toMatchObject({
      content: "draft",
    });

    const withdrawn = await store.moveFile(alice.memberId, file.fileId, "alice/draft.md");
    expect(withdrawn.visibility).toBe("private");
    await expect(rpc(store.readFile(bob.memberId, file.fileId))).rejects.toThrow();
  });

  it("does not let a rename quietly unpublish a public file", async () => {
    const { store } = await newProject();
    const file = await write(store, alice.memberId, "shared/post.md", "post",
                             { visibility: "public" });
    const moved = await store.moveFile(alice.memberId, file.fileId, "alice/post.md");
    expect(moved.visibility).toBe("public");
  });

  it("lets a non-member read a public file and nothing else", async () => {
    const { store } = await newProject();
    const open = await write(store, alice.memberId, "shared/post.md", "public post",
                             { visibility: "public" });
    const closed = await write(store, alice.memberId, "shared/plan.md", "project plan");

    await expect(rpc(store.fetchForLink(open.fileId, null))).resolves.toMatchObject({ ok: true });
    await expect(rpc(store.fetchForLink(closed.fileId, null))).resolves.toMatchObject({
      ok: false, status: 404,
    });
  });
});

describe("writes", () => {
  it("lets only a file's owner overwrite it, and says what to do instead", async () => {
    const { store } = await projectWithBob();
    const file = await write(store, alice.memberId, "shared/plan.md", "Alice's plan");

    await expect(write(store, bob.memberId, "shared/plan.md", "Bob's plan"))
      .rejects.toThrow(/copyFile/);
    await expect(rpc(store.planWrite(bob.memberId, { path: "shared/plan.md", size: 4 })))
      .rejects.toThrow(/only its owner/);
    await expect(rpc(store.moveFile(bob.memberId, file.fileId, "shared/bob.md")))
      .rejects.toThrow(/only its owner/);
    await expect(rpc(store.setFileVisibility(bob.memberId, file.fileId, "public")))
      .rejects.toThrow(/only its owner/);

    // Alice's own overwrite replaces the contents rather than adding a second row.
    await write(store, alice.memberId, "shared/plan.md", "Alice's plan, revised",
                { fileId: file.fileId });
    await expect(rpc(store.readFile(alice.memberId, file.fileId))).resolves.toMatchObject({
      content: "Alice's plan, revised",
    });
    expect(await store.listFiles(alice.memberId, { limit: 10 })).toHaveLength(1);
  });

  it("reports who may write in the summary the agent sees", async () => {
    const { store } = await projectWithBob();
    const file = await write(store, alice.memberId, "shared/plan.md", "plan");
    const [asAlice] = await store.listFiles(alice.memberId, { limit: 10 });
    const [asBob] = await store.listFiles(bob.memberId, { limit: 10 });
    expect(asAlice.writable).toBe(true);
    expect(asBob.writable).toBe(false);
    expect(asBob.ownerName).toBe("Alice");
    expect(file.fileId).toBe(asBob.fileId);
  });

  it("refuses to take a path another member already holds", async () => {
    const { store } = await projectWithBob();
    await write(store, alice.memberId, "shared/plan.md", "Alice's plan");
    const bobs = await write(store, bob.memberId, "bob/plan.md", "Bob's plan");
    await expect(rpc(store.moveFile(bob.memberId, bobs.fileId, "shared/plan.md")))
      .rejects.toThrow(/already taken/);
  });

  it("lets a project owner delete another member's file, and a member not", async () => {
    const { store } = await projectWithBob();
    const bobs = await write(store, bob.memberId, "shared/bob.md", "notes");
    const alices = await write(store, alice.memberId, "shared/alice.md", "notes");

    await expect(rpc(store.deleteFile(bob.memberId, alices.fileId)))
      .rejects.toThrow(/project owner/);
    await store.deleteFile(alice.memberId, bobs.fileId);
    expect((await store.listFiles(alice.memberId, { limit: 10 })).map((file) => file.path))
      .toEqual(["shared/alice.md"]);
  });
});

describe("quotas", () => {
  // The suite's own miniflare config sets these deliberately small.
  it("refuses a file past the per-file limit", async () => {
    const { store } = await newProject();
    await expect(rpc(store.planWrite(alice.memberId, { path: "big.bin", size: 5000 })))
      .rejects.toThrow(/at most 4096/);
  });

  it("refuses a file that does not fit in what is left", async () => {
    const { store } = await newProject();
    await write(store, alice.memberId, "one.md", "x".repeat(4000));
    await write(store, alice.memberId, "two.md", "x".repeat(4000));
    await expect(rpc(store.planWrite(alice.memberId, { path: "three.md", size: 1000 })))
      .rejects.toThrow(/does not fit/);
  });

  it("charges an overwrite only for the difference, so a rewrite still fits", async () => {
    const { store } = await newProject();
    const file = await write(store, alice.memberId, "one.md", "x".repeat(4000));
    await write(store, alice.memberId, "two.md", "x".repeat(4000));
    await expect(write(store, alice.memberId, "one.md", "y".repeat(4000),
                       { fileId: file.fileId })).resolves.toMatchObject({ size: 4000 });
  });

  it("refuses a new file past the count limit", async () => {
    const { store } = await newProject();
    for (let i = 0; i < 5; i++) await write(store, alice.memberId, `f${i}.md`, "x");
    await expect(rpc(store.planWrite(alice.memberId, { path: "f5.md", size: 1 })))
      .rejects.toThrow(/limit of 5 files/);
    // Replacing one of the five is still allowed: the count does not change.
    await expect(rpc(store.planWrite(alice.memberId, { path: "f0.md", size: 1 })))
      .resolves.toBeTruthy();
  });
});

describe("comments", () => {
  it("keeps the discussion of a public file inside the project", async () => {
    const { store } = await projectWithBob();
    const post = await write(store, alice.memberId, "shared/post.md", "post",
                             { visibility: "public" });
    await store.addComment(bob.memberId, {
      commentId: newId(), fileId: post.fileId, body: "Second paragraph is wrong.",
      anchor: { kind: "file" },
    });

    // Members see it; the file's own bytes are public but the thread is not reachable at all
    // without a member id, because every read path here demands one.
    expect(await store.listComments(alice.memberId, post.fileId)).toHaveLength(1);
    await expect(rpc(store.listComments(outsider, post.fileId))).rejects.toThrow();
    await expect(rpc(store.fetchForLink(post.fileId, null))).resolves.toMatchObject({ ok: true });
  });

  it("anchors a comment to a character range, a page, or the whole file", async () => {
    const { store } = await newProject();
    const file = await write(store, alice.memberId, "shared/notes.md", "Hello there");
    for (const anchor of [
      { kind: "file" } as const,
      { kind: "page", page: 2 } as const,
      { kind: "text", start: 6, end: 11, quote: "there" } as const,
    ]) {
      await store.addComment(alice.memberId, {
        commentId: newId(), fileId: file.fileId, body: "note", anchor,
      });
    }
    const comments = await store.listComments(alice.memberId, file.fileId);
    expect(comments.map((comment) => comment.anchor)).toEqual([
      { kind: "file" },
      { kind: "page", page: 2 },
      { kind: "text", start: 6, end: 11, quote: "there" },
    ]);
    expect(comments[0].authorName).toBe("Alice");
    await expect(rpc(store.statFile(alice.memberId, file.fileId)))
      .resolves.toMatchObject({ commentCount: 3 });
  });

  it("will not comment on, or reply into, a file the member cannot read", async () => {
    const { store } = await projectWithBob();
    const secret = await write(store, alice.memberId, "alice/secret.md", "secret");
    await expect(rpc(store.planComment(bob.memberId, secret.fileId))).rejects.toThrow();
    await expect(rpc(store.addComment(bob.memberId, {
      commentId: newId(), fileId: secret.fileId, body: "peeking", anchor: { kind: "file" },
    }))).rejects.toThrow();
  });

  it("keeps a reply on the file it replies into", async () => {
    const { store } = await projectWithBob();
    const one = await write(store, alice.memberId, "shared/a.md", "a");
    const two = await write(store, alice.memberId, "shared/b.md", "b");
    const parent = await store.addComment(alice.memberId, {
      commentId: newId(), fileId: one.fileId, body: "first", anchor: { kind: "file" },
    });
    await expect(rpc(store.planComment(bob.memberId, two.fileId, parent.commentId)))
      .rejects.toThrow();
    await expect(rpc(store.addComment(bob.memberId, {
      commentId: newId(), fileId: one.fileId, body: "agreed", anchor: { kind: "file" },
      replyTo: parent.commentId,
    }))).resolves.toMatchObject({ replyTo: parent.commentId });
  });

  it("lets the author, the file's owner and a project owner resolve, and no one else", async () => {
    const { store } = await projectWithBob();
    const file = await write(store, bob.memberId, "shared/bob.md", "notes");
    const byBob = await store.addComment(bob.memberId, {
      commentId: newId(), fileId: file.fileId, body: "mine", anchor: { kind: "file" },
    });
    const byAlice = await store.addComment(alice.memberId, {
      commentId: newId(), fileId: file.fileId, body: "hers", anchor: { kind: "file" },
    });

    // Bob is the author of one and the file's owner for the other; Alice is the project owner.
    await expect(rpc(store.resolveComment(bob.memberId, byBob.commentId)))
      .resolves.toBeUndefined();
    await expect(rpc(store.resolveComment(bob.memberId, byAlice.commentId)))
      .resolves.toBeUndefined();
    await expect(rpc(store.resolveComment(alice.memberId, byBob.commentId)))
      .resolves.toBeUndefined();
    await expect(rpc(store.resolveComment(outsider, byBob.commentId))).rejects.toThrow();
    const resolved = await store.listComments(bob.memberId, file.fileId);
    expect(resolved.every((comment) => comment.resolved)).toBe(true);
  });

  it("drops a file's comments with the file", async () => {
    const { store } = await newProject();
    const file = await write(store, alice.memberId, "shared/notes.md", "notes");
    await store.addComment(alice.memberId, {
      commentId: newId(), fileId: file.fileId, body: "note", anchor: { kind: "file" },
    });
    await store.deleteFile(alice.memberId, file.fileId);
    expect(await store.listComments(alice.memberId)).toEqual([]);
  });
});

describe("shared configuration", () => {
  it("is readable and writable by any member, and by nobody else", async () => {
    const { store } = await projectWithBob();
    await store.setEnvVar(bob.memberId, "API_BASE", "https://api.example.com", "Where to call");
    await expect(rpc(store.getEnvVar(alice.memberId, "API_BASE")))
      .resolves.toBe("https://api.example.com");
    await expect(rpc(store.listEnvVars(alice.memberId))).resolves.toEqual([{
      name: "API_BASE",
      description: "Where to call",
      updatedBy: "Bob",
      updated: expect.any(String),
    }]);
    await expect(rpc(store.getEnvVar(outsider, "API_BASE"))).rejects.toThrow();
    await expect(rpc(store.setEnvVar(outsider, "API_BASE", "evil", ""))).rejects.toThrow();
  });

  it("lists names without their contents", async () => {
    const { store } = await newProject();
    await store.setEnvVar(alice.memberId, "TOKEN", "s3cret", "");
    const listed = await store.listEnvVars(alice.memberId);
    expect(JSON.stringify(listed)).not.toContain("s3cret");
  });

  it("replaces a value rather than adding a second one", async () => {
    const { store } = await newProject();
    await store.setEnvVar(alice.memberId, "TOKEN", "one", "");
    await store.setEnvVar(alice.memberId, "TOKEN", "two", "");
    expect(await store.listEnvVars(alice.memberId)).toHaveLength(1);
    await expect(rpc(store.getEnvVar(alice.memberId, "TOKEN"))).resolves.toBe("two");
    await store.deleteEnvVar(alice.memberId, "TOKEN");
    await expect(rpc(store.getEnvVar(alice.memberId, "TOKEN"))).rejects.toThrow();
  });
});

describe("skills", () => {
  it("are ordinary shared files, findable as skills", async () => {
    const { store } = await projectWithBob();
    await write(store, alice.memberId, "shared/skills/review.md", "How we review",
                { skillName: "code-review" });
    await write(store, alice.memberId, "shared/plan.md", "plan");
    const skills = await store.listFiles(bob.memberId, { skillsOnly: true, limit: 10 });
    expect(skills.map((file) => file.skillName)).toEqual(["code-review"]);
    await expect(rpc(store.searchFiles(bob.memberId, "code-review", 10))).resolves.toHaveLength(1);
  });
});

describe("links", () => {
  it("gives a public file a stable link and everything else a short-lived one", async () => {
    const { store } = await newProject();
    const open = await write(store, alice.memberId, "shared/post.md", "post",
                             { visibility: "public" });
    const closed = await write(store, alice.memberId, "shared/plan.md", "plan");

    const openLink = await store.mintLink(alice.memberId, open.fileId);
    expect(openLink.expires).toBe(null);
    expect(openLink.url).not.toContain("?t=");

    const closedLink = await store.mintLink(alice.memberId, closed.fileId);
    expect(closedLink.expires).not.toBe(null);
    expect(closedLink.url).toContain("?t=");
  });

  it("honours a signed token, and only for the file it was signed for", async () => {
    const { store } = await projectWithBob();
    const one = await write(store, alice.memberId, "shared/a.md", "first");
    const two = await write(store, alice.memberId, "shared/b.md", "second");
    const token = await mintToken(store, one.fileId);

    await expect(rpc(store.fetchForLink(one.fileId, token))).resolves.toMatchObject({ ok: true });
    await expect(rpc(store.fetchForLink(two.fileId, token))).resolves.toMatchObject({
      ok: false, status: 404,
    });
    await expect(rpc(store.fetchForLink(one.fileId, "1799999999999.deadbeef")))
      .resolves.toMatchObject({ ok: false });
    await expect(rpc(store.fetchForLink(one.fileId, null))).resolves.toMatchObject({ ok: false });
  });

  it("refuses a token whose expiry has passed", async () => {
    const { store } = await newProject();
    const file = await write(store, alice.memberId, "shared/a.md", "first");
    // Same signature, expiry rewritten. The signature covers the expiry, so this is also the check
    // that the holder of a link cannot extend it themselves.
    const [, signature] = (await mintToken(store, file.fileId)).split(".");
    await expect(rpc(store.fetchForLink(file.fileId, `${Date.now() - 1}.${signature}`)))
      .resolves.toMatchObject({ ok: false });
  });

  /** The `t` parameter from a freshly minted link. */
  async function mintToken(store: Store, fileId: string): Promise<string> {
    const { url } = await store.mintLink(alice.memberId, fileId);
    return new URL(url).searchParams.get("t")!;
  }
});

describe("observer verification", () => {
  let store: Store;
  let fileId: string;

  beforeEach(async () => {
    const project = await projectWithBob();
    store = project.store;
    fileId = (await write(store, alice.memberId, "shared/plan.md", "plan")).fileId;
  });

  it("lets a member re-observe anything the project shares", async () => {
    await expect(rpc(store.canObserve(bob.memberId, "p:x"))).resolves.toBe(true);
    await expect(rpc(store.canObserve(outsider, "p:x"))).resolves.toBe(false);
  });

  it("stops being satisfied once the file it names is made private again", async () => {
    const set = `f:x:${fileId}`;
    await expect(rpc(store.canObserve(bob.memberId, set))).resolves.toBe(true);
    await store.setFileVisibility(alice.memberId, fileId, "private");
    await expect(rpc(store.canObserve(bob.memberId, set))).resolves.toBe(false);
    // Its owner still may, which is what makes this about the observer rather than the file.
    await expect(rpc(store.canObserve(alice.memberId, set))).resolves.toBe(true);
  });

  it("stops being satisfied once the observer is removed from the project", async () => {
    const set = `f:x:${fileId}`;
    await store.removeMember(alice.memberId, bob.memberId);
    await expect(rpc(store.canObserve(bob.memberId, set))).resolves.toBe(false);
    await expect(rpc(store.canObserve(bob.memberId, "p:x"))).resolves.toBe(false);
  });

  it("declines a deleted file and a set id it did not mint", async () => {
    await store.deleteFile(alice.memberId, fileId);
    await expect(rpc(store.canObserve(bob.memberId, `f:x:${fileId}`))).resolves.toBe(false);
    await expect(rpc(store.canObserve(bob.memberId, "nonsense"))).resolves.toBe(false);
  });
});
