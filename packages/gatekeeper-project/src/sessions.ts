// The API the agent actually calls, and the only place that decides which reads are observations
// and which writes are actions.
//
// Sessions talk to their surroundings through `ProjectHost` rather than to a Durable Object
// directly. That keeps the rules here -- what gets authorized, what gets submitted, what error an
// agent is told -- testable against a fake, and it is also what lets one implementation serve both
// bindings this gatekeeper offers: the ambient directory over every project, and a narrow binding
// scoped to one.

import { RpcTarget } from "cloudflare:workers";
import { validateRpc } from "capnweb-validate";
import type { ActionDescription, ObservationDescription } from "@gadgets/workshop-shared/gatekeeper";
import {
  LINK_LIFETIME_MS,
  ProjectError,
  decodeContent,
  fileName,
  fileSet,
  fileSets,
  formatInviteCode,
  indexedText,
  inferMimeType,
  newId,
  normalizePath,
  notFound,
  parseAnchor,
  parseCommentBody,
  parseDescription,
  parseEnvVarName,
  parseInviteCode,
  parseLimit,
  parseName,
  parseRole,
  parseVisibility,
  projectSet,
  visibilityAfterMove,
} from "./model.js";
import type { StagedWrite } from "./project-store.js";
import type {
  ProjectComment,
  ProjectCommentAnchor,
  ProjectDirectory,
  ProjectEnvVar,
  ProjectFileContent,
  ProjectFileMatch,
  ProjectFileSummary,
  ProjectFileVisibility,
  ProjectFileWrite,
  ProjectInvite,
  ProjectMember,
  ProjectRequest,
  ProjectRole,
  ProjectSummary,
  ProjectWorkspace,
} from "./types.js";

/** The subset of `ProjectDurableObject` a session uses. */
export interface ProjectStore {
  initialize(projectId: string, name: string, description: string,
             caller: { memberId: string; displayName?: string }): Promise<ProjectSummary>;
  summaryFor(memberId: string): Promise<ProjectSummary | null>;
  listMembers(memberId: string): Promise<ProjectMember[]>;
  setDisplayName(memberId: string, displayName: string): Promise<void>;
  planInvite(memberId: string): Promise<void>;
  commitInvite(memberId: string, secret: string, role: ProjectRole,
               expiresAt: number): Promise<void>;
  revokeInvite(secret: string): Promise<void>;
  redeemInvite(secret: string,
               caller: { memberId: string; displayName?: string }): Promise<ProjectSummary>;
  removeMember(memberId: string, targetId: string): Promise<void>;
  listFiles(memberId: string, opts: {
    pathPrefix?: string; ownerId?: string; visibility?: ProjectFileVisibility;
    skillsOnly?: boolean; limit: number;
  }): Promise<ProjectFileSummary[]>;
  searchFiles(memberId: string, query: string, limit: number):
      Promise<{ file: ProjectFileSummary; snippet: string }[]>;
  statFile(memberId: string, fileId: string): Promise<ProjectFileSummary>;
  readFile(memberId: string, fileId: string): Promise<ProjectFileContent>;
  planWrite(memberId: string, plan: {
    path: string; fileId?: string; size: number; visibility?: ProjectFileVisibility;
  }): Promise<{ fileId: string; visibility: ProjectFileVisibility; replacesContentKey?: string }>;
  commitWrite(memberId: string, write: StagedWrite): Promise<ProjectFileSummary>;
  moveFile(memberId: string, fileId: string, path: string): Promise<ProjectFileSummary>;
  setFileVisibility(memberId: string, fileId: string,
                    visibility: ProjectFileVisibility): Promise<ProjectFileSummary>;
  deleteFile(memberId: string, fileId: string): Promise<void>;
  listComments(memberId: string, fileId?: string): Promise<ProjectComment[]>;
  planComment(memberId: string, fileId: string, replyTo?: string): Promise<void>;
  addComment(memberId: string, comment: {
    commentId: string; fileId: string; body: string; anchor: ProjectCommentAnchor;
    replyTo?: string;
  }): Promise<ProjectComment>;
  resolveComment(memberId: string, commentId: string, resolved?: boolean): Promise<void>;
  deleteComment(memberId: string, commentId: string): Promise<void>;
  listEnvVars(memberId: string): Promise<ProjectEnvVar[]>;
  getEnvVar(memberId: string, name: string): Promise<string>;
  setEnvVar(memberId: string, name: string, value: string, description: string): Promise<void>;
  deleteEnvVar(memberId: string, name: string): Promise<void>;
  mintLink(memberId: string, fileId: string): Promise<{ url: string; expires: string | null }>;
  canObserve(memberId: string, setId: string): Promise<boolean>;
  isMember(memberId: string): Promise<boolean>;
}

/** A write whose effects wait for a human. */
export type PendingAction =
  | {
      kind: "createProject"; projectId: string; name: string; description: string;
      displayName: string;
    }
  | { kind: "joinProject"; projectId: string; secret: string; displayName: string }
  | { kind: "createInvite"; projectId: string; secret: string; role: ProjectRole; expiresAt: number }
  | { kind: "removeMember"; projectId: string; targetId: string }
  | { kind: "setDisplayName"; displayName: string; previous: string }
  | { kind: "writeFile"; projectId: string; write: StagedWrite; created: boolean }
  | {
      kind: "moveFile"; projectId: string; fileId: string; path: string; previousPath: string;
    }
  | {
      kind: "setVisibility"; projectId: string; fileId: string;
      visibility: ProjectFileVisibility; previous: ProjectFileVisibility;
    }
  | { kind: "deleteFile"; projectId: string; fileId: string }
  | {
      kind: "addComment"; projectId: string; commentId: string; fileId: string; body: string;
      anchor: ProjectCommentAnchor; replyTo?: string;
    }
  | { kind: "resolveComment"; projectId: string; commentId: string }
  | {
      kind: "setEnvVar"; projectId: string; name: string; value: string; description: string;
      previous?: { value: string; description: string };
    }
  | {
      kind: "deleteEnvVar"; projectId: string; name: string;
      previous: { value: string; description: string };
    };

/**
 * The account's reach into projects, shared by the sessions that ask for writes and the code in
 * `actions.ts` that carries them out once a human agrees. Both need exactly the same access, and
 * neither should be able to widen it.
 */
export interface ProjectContext {
  /** The connected account, which is who a project knows as a member. */
  readonly memberId: string;

  store(projectId: string): ProjectStore;

  /** Projects this account has joined, as an index that may name projects it has since left. */
  listProjectIds(): Promise<string[]>;

  /** Note that this account belongs to a project, or no longer does. */
  rememberProject(projectId: string): Promise<void>;
  forgetProjects(live: readonly ProjectSummary[]): Promise<void>;

  /** The name this account shows other members, as this account prefers it. */
  getDisplayName(): Promise<string>;
  setDisplayName(displayName: string): Promise<void>;

  /** Stage file bytes, returning the key they were stored under. */
  stageBytes(projectId: string, fileId: string, bytes: Uint8Array): Promise<string>;

  /** Drop bytes staged for a write that will not happen. */
  discardBytes(contentKey: string): Promise<void>;

  projectUrl(projectId: string): string;
  fileUrl(projectId: string, fileId: string): string;
}

/** What a session needs from the Durable Object hosting it. */
export interface ProjectHost extends ProjectContext {
  /**
   * Record an observation, naming the data sets it reveals.
   *
   * The host marks unseen sets before it awaits anything, so an observer admitted while this is in
   * flight is still checked against them.
   */
  authorize(setIds: readonly string[], description: ObservationDescription): Promise<void>;

  /** Queue an action for approval. Returns once queued, not once applied. */
  submit(action: PendingAction, description: ActionDescription): Promise<void>;

  /** Release whatever the host holds for the session, notably its approval queue stub. */
  [Symbol.dispose]?(): void;
}

const MAX_LIST = 200;
const DEFAULT_LIST = 50;
const MAX_SEARCH = 50;
const DEFAULT_INVITE_DAYS = 14;
const MAX_INVITE_DAYS = 365;

/** Action kinds a user may choose to auto-approve, and which of them this gatekeeper offers. */
export const ACTION_KINDS = {
  writeOwnFile: { tag: "project.write-own-file", label: "Write one of my own project files" },
  comment: { tag: "project.comment", label: "Comment on a project file" },
  share: { tag: "project.share", label: "Change who can see a project file" },
  configure: { tag: "project.configure", label: "Change a project's shared configuration" },
  membership: { tag: "project.membership", label: "Change a project's membership" },
  identity: { tag: "project.display-name", label: "Change the name project members see" },
  destructive: { tag: "project.delete", label: "Delete a project file" },
} as const;

/**
 * Kinds safe enough to auto-apply once a user opts in.
 *
 * Only the ones confined to the member's own work. Sharing a file, changing shared configuration,
 * touching membership and deleting anything all reach other people in ways a description read
 * afterwards cannot undo, so they stay in front of a human even when a rule would otherwise match.
 */
export const AUTO_APPROVABLE_KINDS = [
  ACTION_KINDS.writeOwnFile,
  ACTION_KINDS.comment,
  ACTION_KINDS.identity,
];

@validateRpc()
export class ProjectWorkspaceSession extends RpcTarget implements ProjectWorkspace {
  readonly #host: ProjectHost;
  readonly #projectId: string;

  constructor(host: ProjectHost, projectId: string) {
    super();
    this.#host = host;
    this.#projectId = projectId;
  }

  async info(): Promise<ProjectSummary> {
    const summary = await this.#summary();
    await this.#host.authorize([projectSet(this.#projectId)], {
      title: `Read the project ${summary.name}`,
      description: `Read the name, description and member count of the project ${summary.name}.`,
    });
    return summary;
  }

  async listMembers(): Promise<ProjectMember[]> {
    const members = await this.#store().listMembers(this.#host.memberId);
    await this.#host.authorize([projectSet(this.#projectId)], {
      title: `List the members of ${await this.#name()}`,
      description: `Read the names and roles of the ${members.length} members of this project.`,
    });
    return members;
  }

  async createInvite(opts?: { role?: ProjectRole; expiresInDays?: number }): Promise<ProjectInvite> {
    const role = opts?.role === undefined ? "member" : parseRole(opts.role);
    const days = parseLimit(opts?.expiresInDays, DEFAULT_INVITE_DAYS, MAX_INVITE_DAYS);
    await this.#store().planInvite(this.#host.memberId);
    const secret = newId();
    const expiresAt = Date.now() + days * 24 * 60 * 60 * 1000;
    await this.#host.submit(
      { kind: "createInvite", projectId: this.#projectId, secret, role, expiresAt },
      {
        title: `Invite someone to ${await this.#name()} as ${role}`,
        description:
          `Create an invitation code that lets one or more people join this project as ${role}. ` +
          `It stops working after ${days} days. Anyone given the code can join, so treat it as a ` +
          `password.`,
        implementsRevert: true,
        awaitDecision: true,
        actionKind: ACTION_KINDS.membership,
      });
    return {
      code: formatInviteCode(this.#projectId, secret),
      role,
      expires: new Date(expiresAt).toISOString(),
    };
  }

  async removeMember(memberId: string): Promise<void> {
    const target = (await this.#store().listMembers(this.#host.memberId))
      .find((member) => member.memberId === memberId);
    if (!target) throw notFound("That member");
    await this.#host.submit(
      { kind: "removeMember", projectId: this.#projectId, targetId: memberId },
      {
        title: `Remove ${target.displayName || "a member"} from ${await this.#name()}`,
        description:
          `Remove ${target.displayName || memberId} from this project and revoke the invitations ` +
          `they created. Files they shared with the project stay, under their name; their private ` +
          `files become unreachable.`,
        implementsRevert: false,
        awaitDecision: true,
        actionKind: ACTION_KINDS.membership,
      });
  }

  async listFiles(opts?: {
    pathPrefix?: string;
    ownerId?: string;
    visibility?: ProjectFileVisibility;
    skillsOnly?: boolean;
    limit?: number;
  }): Promise<ProjectFileSummary[]> {
    const files = await this.#store().listFiles(this.#host.memberId, {
      ...(opts?.pathPrefix ? { pathPrefix: normalizePath(opts.pathPrefix) } : {}),
      ...(opts?.ownerId ? { ownerId: opts.ownerId } : {}),
      ...(opts?.visibility ? { visibility: parseVisibility(opts.visibility) } : {}),
      ...(opts?.skillsOnly ? { skillsOnly: true } : {}),
      limit: parseLimit(opts?.limit, DEFAULT_LIST, MAX_LIST),
    });
    await this.#host.authorize(
      [projectSet(this.#projectId), ...fileSets(this.#projectId, files)],
      {
        title: `List files in ${await this.#name()}`,
        description: describeFiles(files, "Listed"),
      });
    return files;
  }

  async searchFiles(query: string, opts?: { limit?: number }): Promise<ProjectFileMatch[]> {
    const text = parseName(query, "search query", 512);
    const matches = await this.#store().searchFiles(
      this.#host.memberId, text, parseLimit(opts?.limit, 20, MAX_SEARCH));
    await this.#host.authorize(
      [projectSet(this.#projectId), ...fileSets(this.#projectId, matches.map((m) => m.file))],
      {
        title: `Search ${await this.#name()} for "${text}"`,
        description: describeFiles(matches.map((match) => match.file), "Matched") +
          `\n\nEach result includes an excerpt of the matching text.`,
      });
    return matches;
  }

  async readFile(fileId: string): Promise<ProjectFileContent> {
    const file = await this.#store().readFile(this.#host.memberId, fileId);
    await this.#host.authorize(
      file.visibility === "public" ? [] : [fileSet(this.#projectId, file.fileId)],
      {
        title: `Read ${file.path}`,
        description:
          `Read the full contents of ${file.path} (${file.mimeType}, ${file.size} bytes, ` +
          `${file.visibility}) from the project ${await this.#name()}. ` +
          `It belongs to ${file.ownerName || file.ownerId}.`,
      });
    return file;
  }

  async writeFile(file: ProjectFileWrite): Promise<ProjectFileSummary> {
    if (typeof file !== "object" || file === null) {
      throw new ProjectError("writeFile() takes an object describing the file.");
    }
    const path = normalizePath(file.path);
    const decoded = decodeContent(file.content, file.mimeType);
    const mimeType = decoded.mimeType ?? inferMimeType(path);
    const description = parseDescription(file.description);
    const skillName = file.skillName === undefined
      ? undefined
      : parseName(file.skillName, "skill name");
    const plan = await this.#store().planWrite(this.#host.memberId, {
      path,
      ...(file.fileId ? { fileId: file.fileId } : {}),
      size: decoded.bytes.byteLength,
      ...(file.visibility ? { visibility: parseVisibility(file.visibility) } : {}),
    });
    const contentKey = await this.#host.stageBytes(this.#projectId, plan.fileId, decoded.bytes);
    const write: StagedWrite = {
      fileId: plan.fileId,
      contentKey,
      path,
      mimeType,
      size: decoded.bytes.byteLength,
      visibility: plan.visibility,
      description,
      ...(skillName ? { skillName } : {}),
      indexedText: indexedText(decoded.bytes, mimeType),
    };
    const created = plan.replacesContentKey === undefined;
    await this.#host.submit(
      { kind: "writeFile", projectId: this.#projectId, write, created },
      {
        title: `${created ? "Add" : "Update"} ${path} in ${await this.#name()}`,
        description:
          `${created ? "Create" : "Replace the contents of"} ${path} ` +
          `(${mimeType}, ${write.size} bytes) in the project ${await this.#name()}, visible to ` +
          `${describeVisibility(write.visibility)}.` +
          (skillName ? ` Registers it as the skill "${skillName}".` : "") +
          (description ? `\n\nDescription: ${description}` : ""),
        implementsRevert: created,
        awaitDecision: true,
        actionKind: ACTION_KINDS.writeOwnFile,
        autoApprovable: true,
      });
    return {
      fileId: plan.fileId,
      path,
      name: fileName(path),
      mimeType,
      size: write.size,
      visibility: write.visibility,
      ownerId: this.#host.memberId,
      ownerName: await this.#host.getDisplayName(),
      description,
      ...(skillName ? { skillName } : {}),
      writable: true,
      commentCount: 0,
      updated: new Date().toISOString(),
      url: this.#host.fileUrl(this.#projectId, plan.fileId),
    };
  }

  async moveFile(fileId: string, path: string): Promise<ProjectFileSummary> {
    const wanted = normalizePath(path);
    const file = await this.#store().statFile(this.#host.memberId, fileId);
    if (!file.writable) {
      throw new ProjectError(
        `${file.path} belongs to another member and only its owner can move it. ` +
        `Use copyFile() to make your own copy under a new path.`, 403);
    }
    const visibility = visibilityAfterMove(file.visibility, wanted);
    // Widening is the part a human has to see: a rename inside private space is the member's own
    // filing, but a move into `shared/` publishes the file to everyone in the project.
    const widening = visibility !== file.visibility && visibility !== "private";
    await this.#host.submit(
      {
        kind: "moveFile",
        projectId: this.#projectId,
        fileId,
        path: wanted,
        previousPath: file.path,
      },
      {
        title: `Move ${file.path} to ${wanted}`,
        description:
          `Move ${file.path} to ${wanted} in the project ${await this.#name()}.` +
          (visibility === file.visibility
            ? ` It stays visible to ${describeVisibility(visibility)}.`
            : ` Its new path makes it visible to ${describeVisibility(visibility)}, where it was ` +
              `visible to ${describeVisibility(file.visibility)}.`),
        implementsRevert: true,
        awaitDecision: true,
        actionKind: widening ? ACTION_KINDS.share : ACTION_KINDS.writeOwnFile,
        autoApprovable: !widening,
      });
    return { ...file, path: wanted, name: fileName(wanted), visibility };
  }

  async copyFile(
    fileId: string,
    opts: { path: string; description?: string },
  ): Promise<ProjectFileSummary> {
    const source = await this.readFile(fileId);
    return this.writeFile({
      path: opts.path,
      content: source.content,
      mimeType: source.mimeType,
      description: opts.description ?? source.description,
    });
  }

  async setFileVisibility(
    fileId: string,
    visibility: ProjectFileVisibility,
  ): Promise<ProjectFileSummary> {
    const wanted = parseVisibility(visibility);
    const file = await this.#store().statFile(this.#host.memberId, fileId);
    if (!file.writable) {
      throw new ProjectError(
        `${file.path} belongs to another member and only its owner can change who sees it.`, 403);
    }
    await this.#host.submit(
      {
        kind: "setVisibility",
        projectId: this.#projectId,
        fileId,
        visibility: wanted,
        previous: file.visibility,
      },
      {
        title: `Make ${file.path} visible to ${describeVisibility(wanted)}`,
        description:
          `Change ${file.path} in the project ${await this.#name()} from ` +
          `${describeVisibility(file.visibility)} to ${describeVisibility(wanted)}.` +
          (wanted === "public"
            ? " Anyone who can reach this deployment will be able to read it once they hold the " +
              "file's link, whether or not they are a member of this project. Comments stay " +
              "visible only to project members."
            : ""),
        implementsRevert: true,
        awaitDecision: true,
        actionKind: ACTION_KINDS.share,
      });
    return { ...file, visibility: wanted };
  }

  async deleteFile(fileId: string): Promise<void> {
    const file = await this.#store().statFile(this.#host.memberId, fileId);
    await this.#host.submit(
      { kind: "deleteFile", projectId: this.#projectId, fileId },
      {
        title: `Delete ${file.path} from ${await this.#name()}`,
        description:
          `Permanently delete ${file.path} (${file.size} bytes) and its ${file.commentCount} ` +
          `comments from the project ${await this.#name()}. This cannot be undone.`,
        implementsRevert: false,
        awaitDecision: true,
        actionKind: ACTION_KINDS.destructive,
      });
  }

  async getFileLink(fileId: string): Promise<{ url: string; expires: string | null }> {
    const link = await this.#store().mintLink(this.#host.memberId, fileId);
    const file = await this.#store().statFile(this.#host.memberId, fileId);
    await this.#host.authorize(
      file.visibility === "public" ? [] : [fileSet(this.#projectId, fileId)],
      {
        title: `Get a link to ${file.path}`,
        description: link.expires === null
          ? `Get the permanent link to the public file ${file.path}.`
          : `Get a link to ${file.path} that anyone can use to download it until ` +
            `${link.expires}, about ${Math.round(LINK_LIFETIME_MS / 60000)} minutes from now.`,
      });
    return link;
  }

  async listComments(fileId?: string): Promise<ProjectComment[]> {
    const comments = await this.#store().listComments(this.#host.memberId, fileId);
    // Always the project set, even for a public file: comments are member-only whatever the file
    // they hang off, so an observer who is not a member must not see them.
    await this.#host.authorize([projectSet(this.#projectId)], {
      title: fileId === undefined
        ? `Read comments in ${await this.#name()}`
        : `Read comments on a file in ${await this.#name()}`,
      description:
        `Read ${comments.length} comments written by project members` +
        `${fileId === undefined ? " across the files visible to you" : " on one file"}. ` +
        `Comments are only ever visible to members of this project.`,
    });
    return comments;
  }

  async addComment(
    fileId: string,
    body: string,
    opts?: { anchor?: ProjectCommentAnchor; replyTo?: string },
  ): Promise<ProjectComment> {
    const text = parseCommentBody(body);
    const anchor = parseAnchor(opts?.anchor);
    const replyTo = opts?.replyTo;
    await this.#store().planComment(this.#host.memberId, fileId, replyTo);
    const file = await this.#store().statFile(this.#host.memberId, fileId);
    const commentId = newId();
    await this.#host.submit(
      {
        kind: "addComment",
        projectId: this.#projectId,
        commentId,
        fileId,
        body: text,
        anchor,
        ...(replyTo ? { replyTo } : {}),
      },
      {
        title: `Comment on ${file.path}`,
        description:
          `Post a comment on ${describeAnchor(anchor)} of ${file.path} in the project ` +
          `${await this.#name()}, where every member will see it` +
          `${replyTo ? ", as a reply to an existing comment" : ""}.\n\n${text}`,
        implementsRevert: true,
        awaitDecision: true,
        actionKind: ACTION_KINDS.comment,
        autoApprovable: true,
      });
    return {
      commentId,
      fileId,
      authorId: this.#host.memberId,
      authorName: await this.#host.getDisplayName(),
      body: text,
      anchor,
      ...(replyTo ? { replyTo } : {}),
      resolved: false,
      created: new Date().toISOString(),
    };
  }

  async resolveComment(commentId: string): Promise<void> {
    await this.#host.submit(
      { kind: "resolveComment", projectId: this.#projectId, commentId },
      {
        title: `Resolve a comment in ${await this.#name()}`,
        description: `Mark a comment on a file in this project as settled.`,
        implementsRevert: true,
        awaitDecision: true,
        actionKind: ACTION_KINDS.comment,
        autoApprovable: true,
      });
  }

  async listSkills(): Promise<ProjectFileSummary[]> {
    const skills = await this.#store().listFiles(this.#host.memberId, {
      skillsOnly: true,
      limit: MAX_LIST,
    });
    await this.#host.authorize(
      [projectSet(this.#projectId), ...fileSets(this.#projectId, skills)],
      {
        title: `List the skills shared in ${await this.#name()}`,
        description: describeFiles(skills, "Listed") +
          "\n\nSkills are instruction documents the project shares; read one to follow it.",
      });
    return skills;
  }

  async listEnvVars(): Promise<ProjectEnvVar[]> {
    const vars = await this.#store().listEnvVars(this.#host.memberId);
    await this.#host.authorize([projectSet(this.#projectId)], {
      title: `List shared configuration in ${await this.#name()}`,
      description:
        `Read the names and descriptions of this project's ${vars.length} shared configuration ` +
        `values, without their contents: ${vars.map((entry) => entry.name).join(", ") || "none"}.`,
    });
    return vars;
  }

  async getEnvVar(name: string): Promise<string> {
    const key = parseEnvVarName(name);
    const value = await this.#store().getEnvVar(this.#host.memberId, key);
    await this.#host.authorize([projectSet(this.#projectId)], {
      title: `Read the shared configuration value ${key}`,
      description:
        `Read the contents of ${key} from the project ${await this.#name()}. Shared configuration ` +
        `may hold credentials, so treat the value as secret and do not write it anywhere the ` +
        `project's members cannot already see.`,
    });
    return value;
  }

  async setEnvVar(name: string, value: string, description?: string): Promise<void> {
    const key = parseEnvVarName(name);
    if (typeof value !== "string") {
      throw new ProjectError("A configuration value must be a string.");
    }
    const note = parseDescription(description);
    const previous = await this.#previousEnvVar(key);
    await this.#host.submit(
      {
        kind: "setEnvVar",
        projectId: this.#projectId,
        name: key,
        value,
        description: note,
        ...(previous ? { previous } : {}),
      },
      {
        title: `${previous ? "Change" : "Add"} the shared configuration value ${key}`,
        description:
          `${previous ? "Replace" : "Set"} ${key} in the project ${await this.#name()}, where ` +
          `every member can read it. The new value is ${value.length} characters long and is not ` +
          `shown here.` + (note ? `\n\nDescription: ${note}` : ""),
        implementsRevert: true,
        awaitDecision: true,
        actionKind: ACTION_KINDS.configure,
      });
  }

  async deleteEnvVar(name: string): Promise<void> {
    const key = parseEnvVarName(name);
    const previous = await this.#previousEnvVar(key);
    if (!previous) throw notFound(`The configuration value ${key}`);
    await this.#host.submit(
      { kind: "deleteEnvVar", projectId: this.#projectId, name: key, previous },
      {
        title: `Delete the shared configuration value ${key}`,
        description:
          `Remove ${key} from the project ${await this.#name()}. Anything in the project that ` +
          `reads it will stop working.`,
        implementsRevert: true,
        awaitDecision: true,
        actionKind: ACTION_KINDS.configure,
      });
  }

  async #previousEnvVar(name: string): Promise<{ value: string; description: string } | undefined> {
    const existing = (await this.#store().listEnvVars(this.#host.memberId))
      .find((entry) => entry.name === name);
    if (!existing) return undefined;
    return {
      value: await this.#store().getEnvVar(this.#host.memberId, name),
      description: existing.description,
    };
  }

  #store(): ProjectStore {
    return this.#host.store(this.#projectId);
  }

  async #summary(): Promise<ProjectSummary> {
    const summary = await this.#store().summaryFor(this.#host.memberId);
    if (!summary) throw notFound("That project");
    return summary;
  }

  async #name(): Promise<string> {
    return (await this.#summary()).name;
  }
}

@validateRpc()
export class ProjectDirectorySession extends RpcTarget implements ProjectDirectory {
  readonly #host: ProjectHost;

  constructor(host: ProjectHost) {
    super();
    this.#host = host;
  }

  async listProjects(): Promise<ProjectSummary[]> {
    const summaries = await this.#summaries();
    await this.#host.authorize(summaries.map((summary) => projectSet(summary.projectId)), {
      title: "List your projects",
      description: summaries.length === 0
        ? "Looked for shared projects and found none."
        : `Read the names, descriptions and member counts of ${summaries.length} projects: ` +
          `${summaries.map((summary) => summary.name).join(", ")}.`,
    });
    return summaries;
  }

  async createProject(opts: { name: string; description?: string }): Promise<ProjectRequest> {
    const name = parseName(opts?.name, "project name");
    const description = parseDescription(opts?.description);
    const projectId = newId();
    await this.#host.submit(
      { kind: "createProject", projectId, name, description,
        displayName: await this.#host.getDisplayName() },
      {
        title: `Create the project ${name}`,
        description:
          `Create a shared project named ${name}, with you as its owner. A project holds files, ` +
          `comments, skills and shared configuration; it does not share any of your chats.` +
          (description ? `\n\nDescription: ${description}` : ""),
        implementsRevert: false,
        awaitDecision: true,
        actionKind: ACTION_KINDS.membership,
      });
    return { projectId, url: this.#host.projectUrl(projectId), pending: true };
  }

  async joinProject(code: string, opts?: { displayName?: string }): Promise<ProjectRequest> {
    const { projectId, secret } = parseInviteCode(code);
    const displayName = opts?.displayName === undefined
      ? await this.#host.getDisplayName()
      : parseName(opts.displayName, "display name");
    await this.#host.submit(
      { kind: "joinProject", projectId, secret, displayName },
      {
        title: "Join a shared project",
        description:
          `Redeem an invitation code and join the project it belongs to` +
          `${displayName ? ` as "${displayName}"` : ""}. Its members will see your name on files ` +
          `you share and comments you write, and your agent will be able to read what the project ` +
          `shares.`,
        implementsRevert: false,
        awaitDecision: true,
        actionKind: ACTION_KINDS.membership,
      });
    return { projectId, url: this.#host.projectUrl(projectId), pending: true };
  }

  async openProject(projectId: string): Promise<ProjectWorkspace> {
    if (typeof projectId !== "string" || !/^[\da-f]{32}$/.test(projectId)) {
      throw new ProjectError("That is not a project id.");
    }
    if (!await this.#host.store(projectId).isMember(this.#host.memberId)) {
      throw notFound("That project");
    }
    return new ProjectWorkspaceSession(this.#host, projectId);
  }

  /**
   * Choose the name other members see.
   *
   * The preference is this account's own, so it is kept straight away; propagating it into the
   * projects that show it to other people is the part that waits.
   */
  async setDisplayName(displayName: string): Promise<void> {
    const name = parseName(displayName, "display name");
    const previous = await this.#host.getDisplayName();
    if (name === previous) return;
    await this.#host.setDisplayName(name);
    await this.#host.submit(
      { kind: "setDisplayName", displayName: name, previous },
      {
        title: `Appear as "${name}" in your projects`,
        description:
          `Change the name every project you belong to shows other members${previous
            ? `, from "${previous}"` : ""}. It appears on the files you share and the comments ` +
          `you write.`,
        implementsRevert: true,
        awaitDecision: true,
        actionKind: ACTION_KINDS.identity,
        autoApprovable: true,
      });
  }

  /** Every project this account still belongs to, with the index repaired as a side effect. */
  async #summaries(): Promise<ProjectSummary[]> {
    const ids = await this.#host.listProjectIds();
    const summaries: ProjectSummary[] = [];
    for (const projectId of ids) {
      const summary = await this.#host.store(projectId).summaryFor(this.#host.memberId);
      if (summary) summaries.push(summary);
    }
    if (summaries.length !== ids.length) await this.#host.forgetProjects(summaries);
    return summaries;
  }

  /**
   * Ends the session.
   *
   * The workspaces handed out by `openProject()` share this session's host, so they stop working
   * here too -- which is what should happen: they are views of one connection, not connections of
   * their own.
   */
  [Symbol.dispose](): void {
    this.#host[Symbol.dispose]?.();
  }
}

function describeFiles(files: readonly ProjectFileSummary[], verb: string): string {
  if (files.length === 0) return `${verb} no files.`;
  const lines = files.slice(0, 20).map((file) =>
    `- ${file.path} (${file.visibility}, owner ${file.ownerName || file.ownerId})`);
  const rest = files.length > lines.length ? `\n- ...and ${files.length - lines.length} more` : "";
  return `${verb} ${files.length} files, with their paths, owners and descriptions:\n` +
    `${lines.join("\n")}${rest}`;
}

function describeVisibility(visibility: ProjectFileVisibility): string {
  switch (visibility) {
    case "private": return "only you";
    case "project": return "every member of the project";
    case "public": return "anyone with the link";
  }
}

function describeAnchor(anchor: ProjectCommentAnchor): string {
  switch (anchor.kind) {
    case "file": return "the whole";
    case "page": return `page ${anchor.page}`;
    case "text": return `the passage "${anchor.quote.slice(0, 80)}" in`;
  }
}
