// One Durable Object per project: its members, the metadata for every file they share, the
// comments on those files, and the project's shared configuration. File bytes live in R2; this
// object holds the only index of them, so an object nobody has a metadata row for is unreachable.
//
// This is the whole authorization boundary for a project. Every method takes the caller's member id
// and answers only what that member may see, because a project is shared by people whose agents are
// not: the gatekeeper facet asking on one member's behalf must not be able to read another's
// private files by asking differently.

import { DurableObject } from "cloudflare:workers";
import {
  DEFAULT_QUOTA,
  LINK_LIFETIME_MS,
  ProjectError,
  canDelete,
  canRead,
  canWrite,
  defaultVisibility,
  encodeContent,
  fileName,
  hashSecret,
  indexedText,
  newId,
  notFound,
  parseSet,
  snippet,
  visibilityAfterMove,
  type ProjectQuota,
} from "./model.js";
import { fileUrl, projectUrl } from "./links.js";
import type {
  ProjectComment,
  ProjectCommentAnchor,
  ProjectEnvVar,
  ProjectFileContent,
  ProjectFileSummary,
  ProjectFileVisibility,
  ProjectMember,
  ProjectRole,
  ProjectSummary,
} from "./types.js";

/** Who is asking, as the gatekeeper facet knows them. */
export interface Caller {
  memberId: string;
  /** The name to record if this member has not chosen one yet. */
  displayName?: string;
}

/**
 * What a file's link resolves to.
 *
 * A result rather than an exception because the caller is an HTTP handler on the other side of an
 * RPC boundary: it needs the status code, and a thrown error arrives there as a plain `Error`.
 */
export type LinkResult =
  | {
      ok: true;
      bytes: Uint8Array;
      mimeType: string;
      name: string;
      visibility: ProjectFileVisibility;
    }
  | { ok: false; status: number; message: string };

/** A file write that has already been validated and whose bytes are already in R2. */
export interface StagedWrite {
  fileId: string;
  contentKey: string;
  path: string;
  mimeType: string;
  size: number;
  visibility: ProjectFileVisibility;
  description: string;
  skillName?: string;
  indexedText: string;
}

// Row shapes are type aliases rather than interfaces so that `sql.exec<Row>` accepts them: only a
// type alias picks up the implicit index signature that `Record<string, SqlStorageValue>` demands.
type FileRow = {
  file_id: string;
  path: string;
  name: string;
  mime_type: string;
  size: number;
  visibility: string;
  owner_id: string;
  description: string;
  skill_name: string | null;
  content_key: string;
  indexed_text: string;
  comment_count: number;
  updated: number;
};

type MemberRow = {
  member_id: string;
  display_name: string;
  role: string;
  joined: number;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS project (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS members (
  member_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL,
  joined INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS files (
  file_id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  visibility TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  skill_name TEXT,
  content_key TEXT NOT NULL,
  indexed_text TEXT NOT NULL DEFAULT '',
  comment_count INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS files_by_owner ON files (owner_id);
CREATE TABLE IF NOT EXISTS comments (
  comment_id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  body TEXT NOT NULL,
  anchor TEXT NOT NULL,
  reply_to TEXT,
  resolved INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS comments_by_file ON comments (file_id, created);
CREATE TABLE IF NOT EXISTS env_vars (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL,
  updated INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS invites (
  code_hash TEXT PRIMARY KEY,
  created_by TEXT NOT NULL,
  role TEXT NOT NULL,
  expires INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0
);
`;

export class ProjectDurableObject extends DurableObject<Cloudflare.Env> {
  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    for (const statement of SCHEMA.split(";")) {
      if (statement.trim() !== "") ctx.storage.sql.exec(statement);
    }
  }

  // ---------------------------------------------------------------------------
  // Project and membership

  /** Create the project, if it does not exist yet, with `caller` as its owner. */
  async initialize(
    projectId: string,
    name: string,
    description: string,
    caller: Caller,
  ): Promise<ProjectSummary> {
    if (this.#projectRow()) {
      throw new ProjectError("This project already exists.", 409);
    }
    const now = Date.now();
    this.ctx.storage.sql.exec(
      "INSERT INTO project (id, project_id, name, description, created) VALUES (1, ?, ?, ?, ?)",
      projectId, name, description, now);
    this.ctx.storage.sql.exec(
      "INSERT INTO members (member_id, display_name, role, joined) VALUES (?, ?, 'owner', ?)",
      caller.memberId, caller.displayName ?? "", now);
    return this.#summary(this.#requireMember(caller.memberId));
  }

  /** The project as this member sees it, or null when they are not a member. */
  async summaryFor(memberId: string): Promise<ProjectSummary | null> {
    const member = this.#member(memberId);
    return member ? this.#summary(member) : null;
  }

  async listMembers(memberId: string): Promise<ProjectMember[]> {
    this.#requireMember(memberId);
    return this.#memberRows().map(toMember);
  }

  async setDisplayName(memberId: string, displayName: string): Promise<void> {
    this.#requireMember(memberId);
    this.ctx.storage.sql.exec(
      "UPDATE members SET display_name = ? WHERE member_id = ?", displayName, memberId);
  }

  /** Check that this member could invite people, without minting anything. */
  async planInvite(memberId: string): Promise<void> {
    const member = this.#requireMember(memberId);
    if (member.role !== "owner") {
      throw new ProjectError("Only a project owner can invite people.", 403);
    }
  }

  /**
   * Register an invite secret.
   *
   * Only the hash is stored, so a project that leaks its rows still cannot be joined with them; the
   * secret exists only in the code its creator was handed.
   */
  async commitInvite(
    memberId: string,
    secret: string,
    role: ProjectRole,
    expiresAt: number,
  ): Promise<void> {
    await this.planInvite(memberId);
    this.ctx.storage.sql.exec(
      "INSERT INTO invites (code_hash, created_by, role, expires) VALUES (?, ?, ?, ?)",
      await hashSecret(secret), memberId, role, expiresAt);
  }

  async revokeInvite(secret: string): Promise<void> {
    this.ctx.storage.sql.exec(
      "UPDATE invites SET revoked = 1 WHERE code_hash = ?", await hashSecret(secret));
  }

  /** Redeem an invite secret, adding the caller as a member. Idempotent for an existing member. */
  async redeemInvite(secret: string, caller: Caller): Promise<ProjectSummary> {
    const existing = this.#member(caller.memberId);
    if (existing) {
      if (caller.displayName && existing.display_name === "") {
        await this.setDisplayName(caller.memberId, caller.displayName);
      }
      return this.#summary(this.#requireMember(caller.memberId));
    }
    const row = this.ctx.storage.sql.exec<{ role: string; expires: number; revoked: number }>(
      "SELECT role, expires, revoked FROM invites WHERE code_hash = ?",
      await hashSecret(secret)).toArray()[0];
    if (!row || row.revoked !== 0) {
      throw new ProjectError("That invite code is not valid.", 403);
    }
    if (row.expires <= Date.now()) {
      throw new ProjectError("That invite code has expired. Ask for a new one.", 403);
    }
    this.ctx.storage.sql.exec(
      "INSERT INTO members (member_id, display_name, role, joined) VALUES (?, ?, ?, ?)",
      caller.memberId, caller.displayName ?? "", row.role, Date.now());
    return this.#summary(this.#requireMember(caller.memberId));
  }

  /**
   * Remove a member. Their files stay, so the project does not lose shared work when someone
   * leaves, but nothing of theirs is readable through them any more: a departed member's private
   * files become unreachable, and their project-visible ones keep their name on them.
   */
  async removeMember(memberId: string, targetId: string): Promise<void> {
    const member = this.#requireMember(memberId);
    if (member.role !== "owner") {
      throw new ProjectError("Only a project owner can remove members.", 403);
    }
    if (memberId === targetId) {
      throw new ProjectError("A project owner cannot remove themselves.");
    }
    if (!this.#member(targetId)) throw notFound("That member");
    this.ctx.storage.sql.exec("DELETE FROM members WHERE member_id = ?", targetId);
    this.ctx.storage.sql.exec("UPDATE invites SET revoked = 1 WHERE created_by = ?", targetId);
  }

  // ---------------------------------------------------------------------------
  // Files

  async listFiles(memberId: string, opts: {
    pathPrefix?: string;
    ownerId?: string;
    visibility?: ProjectFileVisibility;
    skillsOnly?: boolean;
    limit: number;
  }): Promise<ProjectFileSummary[]> {
    const member = this.#requireMember(memberId);
    let sql = "SELECT * FROM files WHERE 1 = 1";
    const bindings: (string | number)[] = [];
    if (opts.pathPrefix) {
      sql += " AND path LIKE ?";
      bindings.push(`${opts.pathPrefix.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`);
    }
    if (opts.ownerId) {
      sql += " AND owner_id = ?";
      bindings.push(opts.ownerId);
    }
    if (opts.visibility) {
      sql += " AND visibility = ?";
      bindings.push(opts.visibility);
    }
    if (opts.skillsOnly) sql += " AND skill_name IS NOT NULL";
    sql += " ORDER BY updated DESC";
    const rows = this.ctx.storage.sql.exec<FileRow>(sql, ...bindings).toArray();
    return this.#visible(rows, member).slice(0, opts.limit)
      .map((row) => this.#summarize(row, memberId));
  }

  /**
   * Search the files this member can see.
   *
   * A scan, not an index. Every candidate row is already in this object's SQLite and a project is
   * bounded by its file-count quota, so the cost is the same order as listing; an index becomes
   * worth its complexity when projects are allowed to grow past that.
   */
  async searchFiles(memberId: string, query: string, limit: number): Promise<{
    file: ProjectFileSummary;
    snippet: string;
  }[]> {
    const member = this.#requireMember(memberId);
    const rows = this.ctx.storage.sql.exec<FileRow>("SELECT * FROM files").toArray();
    const needle = query.toLowerCase();
    const results: { file: ProjectFileSummary; snippet: string }[] = [];
    for (const row of this.#visible(rows, member)) {
      const haystacks = [row.path, row.description, row.skill_name ?? "", row.indexed_text];
      const hit = haystacks.find((value) => value.toLowerCase().includes(needle));
      if (hit === undefined) continue;
      results.push({
        file: this.#summarize(row, memberId),
        snippet: snippet(row.indexed_text.toLowerCase().includes(needle) ? row.indexed_text : hit,
                         query),
      });
      if (results.length >= limit) break;
    }
    return results;
  }

  /** One file's metadata, if this member may read it. */
  async statFile(memberId: string, fileId: string): Promise<ProjectFileSummary> {
    return this.#summarize(this.#readableRow(memberId, fileId), memberId);
  }

  async readFile(memberId: string, fileId: string): Promise<ProjectFileContent> {
    const row = this.#readableRow(memberId, fileId);
    const bytes = await this.#bytes(row);
    return {
      ...this.#summarize(row, memberId),
      content: encodeContent(bytes, row.mime_type),
    };
  }

  /**
   * The bytes behind a file's link, for the Worker's HTTP route.
   *
   * An HTTP request carries no member identity, so this is the one read path that decides without
   * one: a public file needs nothing, and every other file needs a token this object signed for that
   * exact file, which only a member who could read it at the time could have been given. The check
   * lives here, with the signing key, rather than in the handler.
   */
  async fetchForLink(fileId: string, token: string | null): Promise<LinkResult> {
    const row = this.#row(fileId);
    const visibility = row?.visibility as ProjectFileVisibility | undefined;
    if (!row || visibility !== "public" && !(token && await this.#verifyToken(fileId, token))) {
      const refused = notFound("That file");
      return { ok: false, status: refused.status, message: refused.message };
    }
    try {
      return {
        ok: true,
        bytes: await this.#bytes(row),
        mimeType: row.mime_type,
        name: row.name,
        visibility: visibility!,
      };
    } catch (error) {
      // Reported rather than thrown: an RPC boundary turns a thrown ProjectError into a plain one,
      // and the HTTP handler needs the status.
      const failure = error instanceof ProjectError ? error : new ProjectError(String(error), 500);
      return { ok: false, status: failure.status, message: failure.message };
    }
  }

  /**
   * What a write would produce, without doing it.
   *
   * Actions are approved after the fact, so this runs when the agent asks and the real write runs
   * when a human agrees. Checking twice is the point: this call is what turns "you cannot overwrite
   * someone else's file" into an error the agent can still act on, while `commitWrite` is the gate
   * that actually holds.
   */
  async planWrite(memberId: string, plan: {
    path: string;
    fileId?: string;
    size: number;
    visibility?: ProjectFileVisibility;
  }): Promise<{ fileId: string; visibility: ProjectFileVisibility; replacesContentKey?: string }> {
    this.#requireMember(memberId);
    const quota = this.#quota();
    if (plan.size > quota.maxFileBytes) {
      throw new ProjectError(
        `That file is ${plan.size} bytes; this deployment allows at most ${quota.maxFileBytes}.`);
    }
    const target = plan.fileId
      ? this.#row(plan.fileId) ?? (() => { throw notFound("That file"); })()
      : this.#rowByPath(plan.path);
    if (target && !canWrite(target.owner_id, memberId)) {
      throw new ProjectError(
        `${target.path} belongs to another member and only its owner can change it. ` +
        `Use copyFile() to make your own copy under a new path.`, 403);
    }
    if (target && plan.fileId && target.path !== plan.path) {
      const occupant = this.#rowByPath(plan.path);
      if (occupant && occupant.file_id !== target.file_id) {
        throw new ProjectError(`${plan.path} is already taken.`, 409);
      }
    }
    const totals = this.#totals();
    const priorSize = target?.size ?? 0;
    if (totals.bytes - priorSize + plan.size > quota.maxProjectBytes) {
      throw new ProjectError(
        `This project holds ${totals.bytes} of ${quota.maxProjectBytes} allowed bytes; ` +
        `that file does not fit.`);
    }
    if (!target && totals.count >= quota.maxFileCount) {
      throw new ProjectError(
        `This project already holds its limit of ${quota.maxFileCount} files.`);
    }
    return {
      fileId: target?.file_id ?? newId(),
      visibility: plan.visibility ?? target?.visibility as ProjectFileVisibility ??
        defaultVisibility(plan.path),
      ...(target ? { replacesContentKey: target.content_key } : {}),
    };
  }

  /** Register a staged write. The bytes are already in R2 under `write.contentKey`. */
  async commitWrite(memberId: string, write: StagedWrite): Promise<ProjectFileSummary> {
    this.#requireMember(memberId);
    const existing = this.#row(write.fileId);
    if (existing && !canWrite(existing.owner_id, memberId)) {
      throw new ProjectError(`${existing.path} belongs to another member.`, 403);
    }
    const occupant = this.#rowByPath(write.path);
    if (occupant && occupant.file_id !== write.fileId) {
      throw new ProjectError(`${write.path} is already taken.`, 409);
    }
    const now = Date.now();
    if (existing) {
      this.ctx.storage.sql.exec(
        "UPDATE files SET path = ?, name = ?, mime_type = ?, size = ?, visibility = ?, " +
        "description = ?, skill_name = ?, content_key = ?, indexed_text = ?, updated = ? " +
        "WHERE file_id = ?",
        write.path, fileName(write.path), write.mimeType, write.size, write.visibility,
        write.description, write.skillName ?? null, write.contentKey, write.indexedText, now,
        write.fileId);
    } else {
      this.ctx.storage.sql.exec(
        "INSERT INTO files (file_id, path, name, mime_type, size, visibility, owner_id, " +
        "description, skill_name, content_key, indexed_text, updated) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        write.fileId, write.path, fileName(write.path), write.mimeType, write.size,
        write.visibility, memberId, write.description, write.skillName ?? null, write.contentKey,
        write.indexedText, now);
    }
    if (existing && existing.content_key !== write.contentKey) {
      await this.#deleteObject(existing.content_key);
    }
    return this.#summarize(this.#requireRow(write.fileId), memberId);
  }

  /**
   * Move one of this member's files, taking the visibility its new path implies.
   *
   * The path and the visibility move together because the path is how people say who should see
   * something; splitting them would let a file sit under `shared/` while staying private.
   */
  async moveFile(memberId: string, fileId: string, path: string): Promise<ProjectFileSummary> {
    this.#requireMember(memberId);
    const row = this.#requireRow(fileId);
    if (!canWrite(row.owner_id, memberId)) {
      throw new ProjectError(
        `${row.path} belongs to another member and only its owner can move it. ` +
        `Use copyFile() to make your own copy under a new path.`, 403);
    }
    const occupant = this.#rowByPath(path);
    if (occupant && occupant.file_id !== fileId) {
      throw new ProjectError(`${path} is already taken.`, 409);
    }
    this.ctx.storage.sql.exec(
      "UPDATE files SET path = ?, name = ?, visibility = ?, updated = ? WHERE file_id = ?",
      path, fileName(path),
      visibilityAfterMove(row.visibility as ProjectFileVisibility, path), Date.now(), fileId);
    return this.#summarize(this.#requireRow(fileId), memberId);
  }

  async setFileVisibility(
    memberId: string,
    fileId: string,
    visibility: ProjectFileVisibility,
  ): Promise<ProjectFileSummary> {
    this.#requireMember(memberId);
    const row = this.#requireRow(fileId);
    if (!canWrite(row.owner_id, memberId)) {
      throw new ProjectError(
        `${row.path} belongs to another member and only its owner can change who sees it.`, 403);
    }
    this.ctx.storage.sql.exec(
      "UPDATE files SET visibility = ?, updated = ? WHERE file_id = ?",
      visibility, Date.now(), fileId);
    return this.#summarize(this.#requireRow(fileId), memberId);
  }

  async deleteFile(memberId: string, fileId: string): Promise<void> {
    const member = this.#requireMember(memberId);
    const row = this.#row(fileId);
    if (!row) return;
    if (!canDelete(row.owner_id, { memberId, role: member.role as ProjectRole })) {
      throw new ProjectError(
        `${row.path} belongs to another member, so only they or a project owner can delete it.`,
        403);
    }
    this.ctx.storage.sql.exec("DELETE FROM comments WHERE file_id = ?", fileId);
    this.ctx.storage.sql.exec("DELETE FROM files WHERE file_id = ?", fileId);
    await this.#deleteObject(row.content_key);
  }

  // ---------------------------------------------------------------------------
  // Comments
  //
  // Comments are member-only, on every file, including public ones: publishing a document is not
  // publishing the discussion about it.

  async listComments(memberId: string, fileId?: string): Promise<ProjectComment[]> {
    const member = this.#requireMember(memberId);
    const names = new Map(this.#memberRows().map((row) => [row.member_id, row.display_name]));
    const readable = new Set(
      this.#visible(this.ctx.storage.sql.exec<FileRow>("SELECT * FROM files").toArray(), member)
        .map((row) => row.file_id));
    if (fileId !== undefined && !readable.has(fileId)) throw notFound("That file");
    const rows = fileId === undefined
      ? this.ctx.storage.sql.exec<CommentRow>(
          "SELECT * FROM comments ORDER BY created").toArray()
      : this.ctx.storage.sql.exec<CommentRow>(
          "SELECT * FROM comments WHERE file_id = ? ORDER BY created", fileId).toArray();
    return rows
      .filter((row) => readable.has(row.file_id))
      .map((row) => toComment(row, names.get(row.author_id) ?? ""));
  }

  /** Check that a comment could be added, without adding it. */
  async planComment(memberId: string, fileId: string, replyTo?: string): Promise<void> {
    this.#readableRow(memberId, fileId);
    if (replyTo !== undefined) {
      const parent = this.#comment(replyTo);
      if (!parent || parent.file_id !== fileId) throw notFound("The comment being replied to");
    }
  }

  async addComment(memberId: string, comment: {
    commentId: string;
    fileId: string;
    body: string;
    anchor: ProjectCommentAnchor;
    replyTo?: string;
  }): Promise<ProjectComment> {
    const member = this.#requireMember(memberId);
    this.#readableRow(memberId, comment.fileId);
    if (comment.replyTo !== undefined) {
      const parent = this.#comment(comment.replyTo);
      if (!parent || parent.file_id !== comment.fileId) {
        throw notFound("The comment being replied to");
      }
    }
    const now = Date.now();
    this.ctx.storage.sql.exec(
      "INSERT INTO comments (comment_id, file_id, author_id, body, anchor, reply_to, created) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?)",
      comment.commentId, comment.fileId, memberId, comment.body, JSON.stringify(comment.anchor),
      comment.replyTo ?? null, now);
    this.ctx.storage.sql.exec(
      "UPDATE files SET comment_count = comment_count + 1 WHERE file_id = ?", comment.fileId);
    return toComment(this.#requireComment(comment.commentId), member.display_name);
  }

  async resolveComment(memberId: string, commentId: string, resolved = true): Promise<void> {
    const member = this.#requireMember(memberId);
    const comment = this.#comment(commentId);
    if (!comment) throw notFound("That comment");
    const file = this.#readableRow(memberId, comment.file_id);
    const mayResolve = comment.author_id === memberId || file.owner_id === memberId ||
      member.role === "owner";
    if (!mayResolve) {
      throw new ProjectError(
        "Only the comment's author, the file's owner, or a project owner can resolve it.", 403);
    }
    this.ctx.storage.sql.exec(
      "UPDATE comments SET resolved = ? WHERE comment_id = ?", resolved ? 1 : 0, commentId);
  }

  async deleteComment(commentId: string): Promise<void> {
    const comment = this.#comment(commentId);
    if (!comment) return;
    this.ctx.storage.sql.exec("DELETE FROM comments WHERE comment_id = ?", commentId);
    this.ctx.storage.sql.exec(
      "UPDATE files SET comment_count = MAX(comment_count - 1, 0) WHERE file_id = ?",
      comment.file_id);
  }

  // ---------------------------------------------------------------------------
  // Shared configuration
  //
  // Any member may read and set these. They are the project's agreed settings -- the values a
  // shared skill or widget needs in order to run for everybody -- so they are scoped to membership
  // and nothing narrower.

  async listEnvVars(memberId: string): Promise<ProjectEnvVar[]> {
    this.#requireMember(memberId);
    const names = new Map(this.#memberRows().map((row) => [row.member_id, row.display_name]));
    return this.ctx.storage.sql.exec<{
      name: string;
      description: string;
      updated_by: string;
      updated: number;
    }>("SELECT name, description, updated_by, updated FROM env_vars ORDER BY name")
      .toArray()
      .map((row) => ({
        name: row.name,
        description: row.description,
        updatedBy: names.get(row.updated_by) ?? "",
        updated: new Date(row.updated).toISOString(),
      }));
  }

  async getEnvVar(memberId: string, name: string): Promise<string> {
    this.#requireMember(memberId);
    const row = this.ctx.storage.sql.exec<{ value: string }>(
      "SELECT value FROM env_vars WHERE name = ?", name).toArray()[0];
    if (!row) throw notFound(`The configuration value ${name}`);
    return row.value;
  }

  async setEnvVar(
    memberId: string,
    name: string,
    value: string,
    description: string,
  ): Promise<void> {
    this.#requireMember(memberId);
    this.ctx.storage.sql.exec(
      "INSERT INTO env_vars (name, value, description, updated_by, updated) VALUES (?, ?, ?, ?, ?) " +
      "ON CONFLICT (name) DO UPDATE SET value = excluded.value, " +
      "description = excluded.description, updated_by = excluded.updated_by, " +
      "updated = excluded.updated",
      name, value, description, memberId, Date.now());
  }

  async deleteEnvVar(memberId: string, name: string): Promise<void> {
    this.#requireMember(memberId);
    this.ctx.storage.sql.exec("DELETE FROM env_vars WHERE name = ?", name);
  }

  // ---------------------------------------------------------------------------
  // Links and observer checks

  /**
   * A link to a file's bytes: stable for a public file, short-lived and signed for every other.
   *
   * The signing key never leaves this object, so a token proves only that whoever minted it could
   * already read the file at the time.
   */
  async mintLink(memberId: string, fileId: string): Promise<{ url: string; expires: string | null }> {
    const row = this.#readableRow(memberId, fileId);
    const projectId = this.#requireProject().project_id;
    const url = fileUrl(this.env, projectId, fileId);
    if (row.visibility === "public") return { url, expires: null };
    const expires = Date.now() + LINK_LIFETIME_MS;
    const token = `${expires}.${await this.#sign(`${fileId}.${expires}`)}`;
    return {
      url: `${url}?t=${encodeURIComponent(token)}`,
      expires: new Date(expires).toISOString(),
    };
  }

  /**
   * Whether a member may still read everything a recorded observation revealed.
   *
   * Answered live against current state, which is what makes it useful: an observer verified when a
   * file was shared with the project fails this check once its owner makes it private again.
   */
  async canObserve(memberId: string, setId: string): Promise<boolean> {
    const parsed = parseSet(setId);
    if (!parsed) return false;
    const member = this.#member(memberId);
    if (!member) return false;
    if (parsed.kind === "project") return true;
    const row = this.#row(parsed.fileId);
    if (!row) return false;
    return canRead(row.visibility as ProjectFileVisibility, row.owner_id,
                   { memberId, isMember: true });
  }

  async isMember(memberId: string): Promise<boolean> {
    return this.#member(memberId) !== undefined;
  }

  // ---------------------------------------------------------------------------

  #quota(): ProjectQuota {
    const number = (value: unknown, fallback: number) => {
      const parsed = typeof value === "string" ? Number(value) : value;
      return typeof parsed === "number" && Number.isFinite(parsed) && parsed > 0
        ? Math.floor(parsed)
        : fallback;
    };
    return {
      maxFileBytes: number(this.env.PROJECT_MAX_FILE_BYTES, DEFAULT_QUOTA.maxFileBytes),
      maxProjectBytes: number(this.env.PROJECT_MAX_TOTAL_BYTES, DEFAULT_QUOTA.maxProjectBytes),
      maxFileCount: number(this.env.PROJECT_MAX_FILE_COUNT, DEFAULT_QUOTA.maxFileCount),
    };
  }

  #totals(): { count: number; bytes: number } {
    const row = this.ctx.storage.sql.exec<{ count: number; bytes: number | null }>(
      "SELECT COUNT(*) AS count, SUM(size) AS bytes FROM files").one();
    return { count: row.count, bytes: row.bytes ?? 0 };
  }

  #projectRow(): { project_id: string; name: string; description: string } | undefined {
    return this.ctx.storage.sql.exec<{ project_id: string; name: string; description: string }>(
      "SELECT project_id, name, description FROM project WHERE id = 1").toArray()[0];
  }

  #requireProject(): { project_id: string; name: string; description: string } {
    const row = this.#projectRow();
    if (!row) throw notFound("That project");
    return row;
  }

  #memberRows(): MemberRow[] {
    return this.ctx.storage.sql.exec<MemberRow>(
      "SELECT * FROM members ORDER BY joined").toArray();
  }

  #member(memberId: string): MemberRow | undefined {
    if (!this.#projectRow()) return undefined;
    return this.ctx.storage.sql.exec<MemberRow>(
      "SELECT * FROM members WHERE member_id = ?", memberId).toArray()[0];
  }

  #requireMember(memberId: string): MemberRow {
    const member = this.#member(memberId);
    if (!member) throw notFound("That project");
    return member;
  }

  #row(fileId: string): FileRow | undefined {
    return this.ctx.storage.sql.exec<FileRow>(
      "SELECT * FROM files WHERE file_id = ?", fileId).toArray()[0];
  }

  #requireRow(fileId: string): FileRow {
    const row = this.#row(fileId);
    if (!row) throw notFound("That file");
    return row;
  }

  #rowByPath(path: string): FileRow | undefined {
    return this.ctx.storage.sql.exec<FileRow>(
      "SELECT * FROM files WHERE path = ?", path).toArray()[0];
  }

  #readableRow(memberId: string, fileId: string): FileRow {
    const row = this.#row(fileId);
    if (!row) throw notFound("That file");
    const member = this.#member(memberId);
    const allowed = canRead(row.visibility as ProjectFileVisibility, row.owner_id,
                            { memberId, isMember: member !== undefined });
    if (!allowed) throw notFound("That file");
    return row;
  }

  #visible(rows: readonly FileRow[], member: MemberRow): FileRow[] {
    return rows.filter((row) => canRead(
      row.visibility as ProjectFileVisibility, row.owner_id,
      { memberId: member.member_id, isMember: true }));
  }

  #summary(member: MemberRow): ProjectSummary {
    const project = this.#requireProject();
    const files = this.#visible(
      this.ctx.storage.sql.exec<FileRow>("SELECT * FROM files").toArray(), member);
    return {
      projectId: project.project_id,
      name: project.name,
      description: project.description,
      role: member.role as ProjectRole,
      memberCount: this.#memberRows().length,
      fileCount: files.length,
      url: projectUrl(this.env, project.project_id),
    };
  }

  #summarize(row: FileRow, memberId: string): ProjectFileSummary {
    const owner = this.#member(row.owner_id);
    return {
      fileId: row.file_id,
      path: row.path,
      name: row.name,
      mimeType: row.mime_type,
      size: row.size,
      visibility: row.visibility as ProjectFileVisibility,
      ownerId: row.owner_id,
      ownerName: owner?.display_name ?? "",
      description: row.description,
      ...(row.skill_name ? { skillName: row.skill_name } : {}),
      writable: canWrite(row.owner_id, memberId),
      commentCount: row.comment_count,
      updated: new Date(row.updated).toISOString(),
      url: fileUrl(this.env, this.#requireProject().project_id, row.file_id),
    };
  }

  #comment(commentId: string): CommentRow | undefined {
    return this.ctx.storage.sql.exec<CommentRow>(
      "SELECT * FROM comments WHERE comment_id = ?", commentId).toArray()[0];
  }

  #requireComment(commentId: string): CommentRow {
    const row = this.#comment(commentId);
    if (!row) throw notFound("That comment");
    return row;
  }

  async #bytes(row: FileRow): Promise<Uint8Array> {
    const object = await this.env.PROJECT_FILES.get(row.content_key);
    if (!object) {
      throw new ProjectError(
        `${row.path} has metadata but no stored contents. Write it again.`, 410);
    }
    return new Uint8Array(await object.arrayBuffer());
  }

  async #deleteObject(key: string): Promise<void> {
    await this.env.PROJECT_FILES.delete(key);
  }

  /** Whether a token this object signed still authorizes reading `fileId`. */
  async #verifyToken(fileId: string, token: string): Promise<boolean> {
    const [expiresText, signature] = token.split(".");
    const expires = Number(expiresText);
    if (!Number.isSafeInteger(expires) || expires <= Date.now() || !signature) return false;
    return timingSafeEqual(signature, await this.#sign(`${fileId}.${expires}`));
  }

  /** HMAC over the project's own key, created on first use and never handed out. */
  async #sign(payload: string): Promise<string> {
    let secret = this.ctx.storage.kv.get<string>("linkKey");
    if (!secret) {
      secret = newId(32);
      this.ctx.storage.kv.put("linkKey", secret);
    }
    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signature = await crypto.subtle.sign(
      "HMAC", key, new TextEncoder().encode(payload));
    return [...new Uint8Array(signature)]
      .map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
}

type CommentRow = {
  comment_id: string;
  file_id: string;
  author_id: string;
  body: string;
  anchor: string;
  reply_to: string | null;
  resolved: number;
  created: number;
};

function toMember(row: MemberRow): ProjectMember {
  return {
    memberId: row.member_id,
    displayName: row.display_name,
    role: row.role as ProjectRole,
    joined: new Date(row.joined).toISOString(),
  };
}

function toComment(row: CommentRow, authorName: string): ProjectComment {
  return {
    commentId: row.comment_id,
    fileId: row.file_id,
    authorId: row.author_id,
    authorName,
    body: row.body,
    anchor: JSON.parse(row.anchor) as ProjectCommentAnchor,
    ...(row.reply_to ? { replyTo: row.reply_to } : {}),
    resolved: row.resolved !== 0,
    created: new Date(row.created).toISOString(),
  };
}

function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  if (left.byteLength !== right.byteLength) return false;
  return crypto.subtle.timingSafeEqual(left, right);
}
