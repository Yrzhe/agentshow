// The layer above the store: what a session authorizes, what it submits for approval, and what
// `actions.ts` does once a human decides. The host here is a fake queue over *real* project Durable
// Objects, so approving an action exercises the same path production takes.
//
// Two members means two hosts, because that is the arrangement being tested: separate accounts, and
// nothing shared but the projects behind them.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { ActionDescription, ObservationDescription } from "@gadgets/workshop-shared/gatekeeper";
import { applyAction, rejectAction, revertAction } from "../src/actions.js";
import type { ProjectDurableObject } from "../src/project-store.js";
import {
  ACTION_KINDS,
  AUTO_APPROVABLE_KINDS,
  ProjectDirectorySession,
  type PendingAction,
  type ProjectHost,
  type ProjectStore,
} from "../src/sessions.js";
import { newId } from "../src/model.js";
import type { ProjectSummary, ProjectWorkspace } from "../src/types.js";

const testEnv = env as unknown as {
  PROJECT_STORE: DurableObjectNamespace<ProjectDurableObject>;
  PROJECT_FILES: R2Bucket;
};

/** One submitted action, with the description a human would have read. */
interface Submission {
  action: PendingAction;
  description: ActionDescription;
}

/**
 * An account, with its approval queue exposed rather than hidden.
 *
 * Production leaves the queue to the Workshop; here it is a list plus an `approve()`, so a test can
 * say "the agent asked for this, and then a human agreed" as two separate steps.
 */
class TestHost implements ProjectHost {
  readonly submitted: Submission[] = [];
  readonly observed: { setIds: string[]; description: ObservationDescription }[] = [];
  #displayName: string;
  #projectIds: string[] = [];

  constructor(readonly memberId: string, displayName = "") {
    this.#displayName = displayName;
  }

  /** The project's real Durable Object, keyed the way production keys it. */
  store(projectId: string): ProjectStore {
    return testEnv.PROJECT_STORE.get(
      testEnv.PROJECT_STORE.idFromName(projectId)) as unknown as ProjectStore;
  }

  async authorize(setIds: readonly string[], description: ObservationDescription): Promise<void> {
    this.observed.push({ setIds: [...setIds], description });
  }

  async submit(action: PendingAction, description: ActionDescription): Promise<void> {
    this.submitted.push({ action, description });
  }

  /** What the Workshop does when the human says yes. */
  async approve(index = this.submitted.length - 1): Promise<void> {
    await applyAction(this, this.submitted[index].action);
  }

  async reject(index = this.submitted.length - 1): Promise<void> {
    await rejectAction(this, this.submitted[index].action);
  }

  async revert(index = this.submitted.length - 1): Promise<void> {
    await revertAction(this, this.submitted[index].action);
  }

  /** The most recent submission, which is what a test almost always means. */
  get last(): Submission {
    return this.submitted.at(-1)!;
  }

  get lastObservation(): { setIds: string[]; description: ObservationDescription } {
    return this.observed.at(-1)!;
  }

  async listProjectIds(): Promise<string[]> {
    return [...this.#projectIds];
  }

  async rememberProject(projectId: string): Promise<void> {
    if (!this.#projectIds.includes(projectId)) this.#projectIds.push(projectId);
  }

  async forgetProjects(live: readonly ProjectSummary[]): Promise<void> {
    const keep = new Set(live.map((summary) => summary.projectId));
    this.#projectIds = this.#projectIds.filter((projectId) => keep.has(projectId));
  }

  async getDisplayName(): Promise<string> {
    return this.#displayName;
  }

  async setDisplayName(displayName: string): Promise<void> {
    this.#displayName = displayName;
  }

  async stageBytes(projectId: string, fileId: string, bytes: Uint8Array): Promise<string> {
    const key = `${projectId}/${fileId}/${newId()}`;
    await testEnv.PROJECT_FILES.put(key, bytes);
    return key;
  }

  async discardBytes(contentKey: string): Promise<void> {
    await testEnv.PROJECT_FILES.delete(contentKey);
  }

  projectUrl(projectId: string): string {
    return `https://os.example.com/gatekeeper/project/p/${projectId}`;
  }

  fileUrl(projectId: string, fileId: string): string {
    return `https://os.example.com/gatekeeper/project/f/${projectId}/${fileId}`;
  }
}

function directory(host: TestHost): ProjectDirectorySession {
  return new ProjectDirectorySession(host);
}

/** Alice, with an approved project she owns and a workspace open on it. */
async function ownedProject(): Promise<{
  alice: TestHost;
  workspace: ProjectWorkspace;
  projectId: string;
}> {
  const alice = new TestHost("alice", "Alice");
  const request = await directory(alice).createProject({ name: "Launch" });
  await alice.approve();
  const workspace = await directory(alice).openProject(request.projectId);
  return { alice, workspace, projectId: request.projectId };
}

describe("starting and joining a project", () => {
  it("waits for a human before the project exists", async () => {
    const alice = new TestHost("alice", "Alice");
    const request = await directory(alice).createProject({ name: "Launch" });

    // The request says so, and it is true: nothing was created yet.
    expect(request.pending).toBe(true);
    expect(request.url).toContain(request.projectId);
    expect(await directory(alice).listProjects()).toEqual([]);
    await expect((async () => directory(alice).openProject(request.projectId))())
      .rejects.toThrow();

    expect(alice.last.action).toMatchObject({ kind: "createProject", name: "Launch" });
    expect(alice.last.description).toMatchObject({
      awaitDecision: true,
      actionKind: ACTION_KINDS.membership,
      implementsRevert: false,
    });
    // The description is what the human decides on, so it has to say the thing that matters here.
    expect(alice.last.description.description).toMatch(/does not share any of your chats/);

    await alice.approve();
    const projects = await directory(alice).listProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({ name: "Launch", role: "owner", memberCount: 1 });
  });

  it("carries a member from an invite through to a shared file", async () => {
    const { alice, workspace, projectId } = await ownedProject();
    const invite = await workspace.createInvite();
    await alice.approve();
    expect(invite.code.startsWith(`${projectId}.`)).toBe(true);

    const bob = new TestHost("bob");
    await directory(bob).joinProject(invite.code, { displayName: "Bob" });
    // Still pending: an invite code is not a way around Bob's own approval queue.
    expect(await directory(bob).listProjects()).toEqual([]);
    await bob.approve();
    expect(await directory(bob).listProjects()).toHaveLength(1);

    await workspace.writeFile({ path: "shared/plan.md", content: "the plan" });
    await alice.approve();

    const bobsWorkspace = await directory(bob).openProject(projectId);
    const files = await bobsWorkspace.listFiles();
    expect(files.map((file) => file.path)).toEqual(["shared/plan.md"]);
    expect(files[0].ownerName).toBe("Alice");
    expect(files[0].writable).toBe(false);
    await expect((async () => bobsWorkspace.readFile(files[0].fileId))())
      .resolves.toMatchObject({ content: "the plan" });
  });

  it("refuses an id that is not a project id, and a project it has not joined", async () => {
    const alice = new TestHost("alice");
    await expect((async () => directory(alice).openProject("nope"))())
      .rejects.toThrow(/not a project id/);
    await expect((async () => directory(alice).openProject(newId()))()).rejects.toThrow();
  });

  it("revokes an invite when the action that made it is reverted", async () => {
    const { alice, workspace } = await ownedProject();
    const invite = await workspace.createInvite();
    await alice.approve();
    expect(alice.last.description.implementsRevert).toBe(true);
    await alice.revert();

    const bob = new TestHost("bob");
    await directory(bob).joinProject(invite.code);
    await expect((async () => bob.approve())()).rejects.toThrow(/not valid/);
  });

  it("will not undo the actions whose descriptions did not promise it", async () => {
    const { alice, workspace } = await ownedProject();
    // createProject said implementsRevert: false, because unmaking a project would take other
    // people's work with it.
    await expect((async () => alice.revert(0))()).rejects.toThrow(/cannot be undone/);

    const file = await workspace.writeFile({ path: "shared/plan.md", content: "one" });
    await alice.approve();
    await workspace.writeFile({ path: "shared/plan.md", content: "two", fileId: file.fileId });
    await alice.approve();
    // Replacing a file is not revertable either: the bytes it overwrote are already gone.
    expect(alice.last.description.implementsRevert).toBe(false);
    await expect((async () => alice.revert())()).rejects.toThrow(/were not kept/);
  });
});

describe("what a human is asked to approve", () => {
  it("marks only a member's own work auto-approvable", async () => {
    const { alice, workspace } = await ownedProject();
    await workspace.writeFile({ path: "alice/draft.md", content: "draft" });
    expect(alice.last.description).toMatchObject({
      actionKind: ACTION_KINDS.writeOwnFile, autoApprovable: true,
    });
    const file = await workspace.writeFile({ path: "alice/notes.md", content: "notes" });
    await alice.approve();

    await workspace.addComment(file.fileId, "a note");
    expect(alice.last.description).toMatchObject({
      actionKind: ACTION_KINDS.comment, autoApprovable: true,
    });

    // Sharing, configuring, membership and deleting all reach other people.
    await workspace.setFileVisibility(file.fileId, "project");
    expect(alice.last.description.actionKind).toBe(ACTION_KINDS.share);
    expect(alice.last.description.autoApprovable).toBeFalsy();

    await workspace.setEnvVar("TOKEN", "s3cret");
    expect(alice.last.description.actionKind).toBe(ACTION_KINDS.configure);
    expect(alice.last.description.autoApprovable).toBeFalsy();

    await workspace.deleteFile(file.fileId);
    expect(alice.last.description.actionKind).toBe(ACTION_KINDS.destructive);
    expect(alice.last.description.autoApprovable).toBeFalsy();
  });

  it("offers exactly the kinds it marks auto-approvable", () => {
    const offered = new Set(AUTO_APPROVABLE_KINDS.map((kind) => kind.tag));
    expect(offered).toEqual(new Set([
      ACTION_KINDS.writeOwnFile.tag, ACTION_KINDS.comment.tag, ACTION_KINDS.identity.tag,
    ]));
    // Every tag is distinct, since a tag is what a saved rule matches on.
    const tags = Object.values(ACTION_KINDS).map((kind) => kind.tag);
    expect(new Set(tags).size).toBe(tags.length);
  });

  it("treats a move that widens visibility as sharing, and a rename as filing", async () => {
    const { alice, workspace } = await ownedProject();
    const file = await workspace.writeFile({ path: "alice/draft.md", content: "draft" });
    await alice.approve();

    await workspace.moveFile(file.fileId, "alice/renamed.md");
    expect(alice.last.description).toMatchObject({
      actionKind: ACTION_KINDS.writeOwnFile, autoApprovable: true,
    });
    expect(alice.last.description.description).toMatch(/stays visible to only you/);
    await alice.approve();

    await workspace.moveFile(file.fileId, "shared/draft.md");
    expect(alice.last.description).toMatchObject({ actionKind: ACTION_KINDS.share });
    expect(alice.last.description.autoApprovable).toBeFalsy();
    expect(alice.last.description.description).toMatch(/every member of the project/);
  });

  it("says what going public does, and what it does not do", async () => {
    const { alice, workspace } = await ownedProject();
    const file = await workspace.writeFile({ path: "shared/post.md", content: "post" });
    await alice.approve();
    await workspace.setFileVisibility(file.fileId, "public");

    const { description } = alice.last.description;
    // Public means "anyone who can reach this deployment", not "the public internet": the router is
    // behind Access. Saying it the other way would scare someone out of a safe action.
    expect(description).toMatch(/reach this deployment/);
    expect(description).toMatch(/[Cc]omments stay visible only to project members/);
  });

  it("never puts a configuration value in the description a human reads", async () => {
    const { alice, workspace } = await ownedProject();
    await workspace.setEnvVar("TOKEN", "swordfish", "The API token");

    const { title, description } = alice.last.description;
    expect(`${title}\n${description}`).not.toContain("swordfish");
    expect(description).toMatch(/9 characters long/);
    expect(description).toMatch(/The API token/);
  });

  it("answers with what the write will look like, before it has happened", async () => {
    const { alice, workspace } = await ownedProject();
    // The agent needs something to carry on with, and waiting for a human is not something it can
    // do. What it gets back is the file as approving would make it.
    const file = await workspace.writeFile({
      path: "shared/notes.md", content: "# Notes", description: "Meeting notes",
    });
    expect(file).toMatchObject({
      path: "shared/notes.md",
      name: "notes.md",
      mimeType: "text/markdown",
      visibility: "project",
      ownerId: "alice",
      ownerName: "Alice",
      description: "Meeting notes",
      writable: true,
      commentCount: 0,
    });
    expect(file.url).toContain(file.fileId);

    await alice.approve();
    const stored = await workspace.readFile(file.fileId);
    expect(stored).toMatchObject({
      fileId: file.fileId, path: file.path, mimeType: file.mimeType, visibility: file.visibility,
      description: file.description, content: "# Notes",
    });
  });
});

describe("rejection", () => {
  it("leaves nothing behind when a file write is refused", async () => {
    const { alice, workspace } = await ownedProject();
    await workspace.writeFile({ path: "shared/plan.md", content: "the plan" });
    const { action } = alice.last;
    expect(action.kind).toBe("writeFile");
    const contentKey = action.kind === "writeFile" ? action.write.contentKey : "";
    // Bytes are stored when the agent asks, so the size and type in the description are the real
    // ones rather than a promise.
    expect(await testEnv.PROJECT_FILES.head(contentKey)).not.toBe(null);

    await alice.reject();
    expect(await testEnv.PROJECT_FILES.head(contentKey)).toBe(null);
    expect(await workspace.listFiles()).toEqual([]);
  });
});

describe("observations", () => {
  it("names the project for anything every member may read", async () => {
    const { alice, workspace, projectId } = await ownedProject();
    await workspace.info();
    expect(alice.lastObservation.setIds).toEqual([`p:${projectId}`]);
    expect(alice.lastObservation.description.title).toContain("Launch");

    await workspace.listMembers();
    expect(alice.lastObservation.setIds).toEqual([`p:${projectId}`]);
  });

  it("names each file a listing revealed, so access can be rechecked", async () => {
    const { alice, workspace, projectId } = await ownedProject();
    const shared = await workspace.writeFile({ path: "shared/plan.md", content: "plan" });
    await alice.approve();
    const own = await workspace.writeFile({ path: "alice/draft.md", content: "draft" });
    await alice.approve();

    await workspace.listFiles();
    expect(new Set(alice.lastObservation.setIds)).toEqual(new Set([
      `p:${projectId}`, `f:${projectId}:${shared.fileId}`, `f:${projectId}:${own.fileId}`,
    ]));
    // The description lists what was read, since that is all a human sees of it.
    expect(alice.lastObservation.description.description).toContain("shared/plan.md");
  });

  it("names nothing for a public file: there is no one to keep it from", async () => {
    const { alice, workspace } = await ownedProject();
    const file = await workspace.writeFile({ path: "shared/post.md", content: "post" });
    await alice.approve();
    await workspace.setFileVisibility(file.fileId, "public");
    await alice.approve();

    await workspace.readFile(file.fileId);
    expect(alice.lastObservation.setIds).toEqual([]);
    await workspace.getFileLink(file.fileId);
    expect(alice.lastObservation.setIds).toEqual([]);
  });

  it("names the project when reading comments, even on a public file", async () => {
    const { alice, workspace, projectId } = await ownedProject();
    const file = await workspace.writeFile({ path: "shared/post.md", content: "post" });
    await alice.approve();
    await workspace.setFileVisibility(file.fileId, "public");
    await alice.approve();
    await workspace.addComment(file.fileId, "needs work");
    await alice.approve();

    // Publishing a document is not publishing the discussion about it, so this read still reveals
    // something only a member may see.
    await workspace.listComments(file.fileId);
    expect(alice.lastObservation.setIds).toEqual([`p:${projectId}`]);
    expect(alice.lastObservation.description.description).toMatch(/only ever visible to members/);
  });

  it("warns that a configuration value may be a credential", async () => {
    const { alice, workspace } = await ownedProject();
    await workspace.setEnvVar("TOKEN", "swordfish");
    await alice.approve();

    expect(await workspace.getEnvVar("TOKEN")).toBe("swordfish");
    expect(alice.lastObservation.description.description).toMatch(/treat the value as secret/);
    // Listing them is a weaker read, and says so: names and descriptions, no contents.
    await workspace.listEnvVars();
    expect(alice.lastObservation.description.description).toMatch(/without their contents/);
  });
});

describe("writing to someone else's work", () => {
  let alice: TestHost;
  let bob: TestHost;
  let bobsWorkspace: ProjectWorkspace;
  let fileId: string;
  let projectId: string;

  beforeEach(async () => {
    const owned = await ownedProject();
    alice = owned.alice;
    projectId = owned.projectId;
    const invite = await owned.workspace.createInvite();
    await alice.approve();
    bob = new TestHost("bob", "Bob");
    await directory(bob).joinProject(invite.code);
    await bob.approve();
    fileId = (await owned.workspace.writeFile({ path: "shared/plan.md", content: "Alice's plan" }))
      .fileId;
    await alice.approve();
    bobsWorkspace = await directory(bob).openProject(owned.projectId);
  });

  it("is refused before anything reaches the approval queue", async () => {
    await expect((async () => bobsWorkspace.writeFile({
      path: "shared/plan.md", content: "Bob's plan",
    }))()).rejects.toThrow(/copyFile/);
    await expect((async () => bobsWorkspace.moveFile(fileId, "shared/bobs-plan.md"))())
      .rejects.toThrow(/only its owner/);
    await expect((async () => bobsWorkspace.setFileVisibility(fileId, "public"))())
      .rejects.toThrow(/only its owner/);
    // Nothing was queued: an agent that cannot do this should be told now, not after a human agrees.
    expect(bob.submitted).toHaveLength(1);
    expect(bob.last.action.kind).toBe("joinProject");
  });

  it("becomes a copy of his own, which he can then change", async () => {
    const copy = await bobsWorkspace.copyFile(fileId, { path: "bob/plan.md" });
    await bob.approve();
    expect(copy).toMatchObject({ ownerId: "bob", writable: true, visibility: "private" });

    const read = await bobsWorkspace.readFile(copy.fileId);
    expect(read.content).toBe("Alice's plan");
    await bobsWorkspace.writeFile({
      path: "bob/plan.md", content: "Bob's plan", fileId: copy.fileId,
    });
    await bob.approve();
    await expect((async () => bobsWorkspace.readFile(copy.fileId))())
      .resolves.toMatchObject({ content: "Bob's plan" });
    // Alice's original is untouched.
    await expect((async () => bobsWorkspace.readFile(fileId))())
      .resolves.toMatchObject({ content: "Alice's plan" });
  });

  it("can still be commented on", async () => {
    const comment = await bobsWorkspace.addComment(fileId, "Second paragraph is wrong.", {
      anchor: { kind: "text", start: 0, end: 6, quote: "Alice'" },
    });
    expect(comment).toMatchObject({ authorId: "bob", authorName: "Bob", resolved: false });
    await bob.approve();

    const comments = await bobsWorkspace.listComments(fileId);
    expect(comments).toHaveLength(1);
    expect(comments[0].anchor).toEqual({ kind: "text", start: 0, end: 6, quote: "Alice'" });
  });

  it("keeps a comment that only its author can take back", async () => {
    const comment = await bobsWorkspace.addComment(fileId, "Second paragraph is wrong.");
    await bob.approve();

    // Alice owns the file and the project, and still cannot remove what Bob said. There is no API
    // for it either -- this is the path an undone approval takes.
    await expect((async () => alice.store(projectId).deleteComment("alice", comment.commentId))())
      .rejects.toThrow(/author/);
    expect(await bobsWorkspace.listComments(fileId)).toHaveLength(1);

    // Undoing Bob's own approved comment still works, which is what that path is for.
    await bob.revert();
    expect(await bobsWorkspace.listComments(fileId)).toEqual([]);
  });
});

describe("display name", () => {
  it("propagates to every project once approved, and back again on revert", async () => {
    const { alice, workspace } = await ownedProject();
    const file = await workspace.writeFile({ path: "shared/plan.md", content: "plan" });
    await alice.approve();

    await directory(alice).setDisplayName("Alice Zhang");
    expect(alice.last.description).toMatchObject({
      actionKind: ACTION_KINDS.identity, autoApprovable: true, implementsRevert: true,
    });
    // The preference is the account's own, so it is kept straight away; what waits is telling the
    // projects that show it to other people.
    expect(await alice.getDisplayName()).toBe("Alice Zhang");
    expect((await workspace.listFiles())[0].ownerName).toBe("Alice");

    await alice.approve();
    expect((await workspace.listFiles())[0].ownerName).toBe("Alice Zhang");
    expect((await workspace.listMembers())[0].displayName).toBe("Alice Zhang");

    await alice.revert();
    expect(await alice.getDisplayName()).toBe("Alice");
    expect((await workspace.listFiles())[0].ownerName).toBe("Alice");
    expect(file.ownerName).toBe("Alice");
  });

  it("queues nothing when the name is already the one asked for", async () => {
    const alice = new TestHost("alice", "Alice");
    await directory(alice).setDisplayName("Alice");
    expect(alice.submitted).toEqual([]);
  });
});

describe("input the agent got wrong", () => {
  it("is refused with something it can act on", async () => {
    const { alice, workspace } = await ownedProject();
    // Each case is a function, not a promise: an RPC call rejects the moment it is made, and a
    // promise waiting its turn in an array has nobody listening yet.
    const cases: [string, () => Promise<unknown>][] = [
      ["a path that escapes the project", () => workspace.writeFile({
        path: "../elsewhere.md", content: "x",
      })],
      ["an empty comment", async () => {
        const file = await workspace.writeFile({ path: "a.md", content: "x" });
        await alice.approve();
        return workspace.addComment(file.fileId, "   ");
      }],
      ["a configuration name that is not one", () => workspace.setEnvVar("not-a-name", "x")],
      ["an invite code from nowhere", () => directory(alice).joinProject("nonsense")],
      ["a project with no name", () => directory(alice).createProject({ name: "  " })],
    ];
    for (const [what, call] of cases) {
      await expect((async () => call())(), what).rejects.toThrow();
    }
  });

  it("does not treat a refused call as an action", async () => {
    const alice = new TestHost("alice");
    await expect((async () => directory(alice).createProject({ name: "" }))())
      .rejects.toThrow();
    expect(alice.submitted).toEqual([]);
  });
});
