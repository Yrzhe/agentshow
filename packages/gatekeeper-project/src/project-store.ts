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
  WIDGET_BACKEND_PATH,
  canDelete,
  canRead,
  canWrite,
  defaultVisibility,
  encodeContent,
  fileName,
  hashSecret,
  newId,
  notFound,
  parseSet,
  snippet,
  visibilityAfterMove,
  widgetAssetPath,
  type ProjectQuota,
  type WidgetPrincipal,
} from "./model.js";
import { fileUrl, projectUrl, widgetUrl } from "./links.js";
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
  ProjectWidgetFile,
  ProjectWidgetFileContent,
  ProjectWidgetSummary,
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

/** A widget whose details have been validated but which does not exist yet. */
export interface StagedWidget {
  widgetId: string;
  name: string;
  path: string;
  description: string;
  visibility: ProjectFileVisibility;
}

/** A write to one file inside a widget, whose bytes are already in R2. */
export interface StagedWidgetFile {
  widgetId: string;
  contentKey: string;
  path: string;
  mimeType: string;
  size: number;
}

/**
 * What a widget's address resolves to for whoever asked.
 *
 * A result rather than an exception for the same reason `LinkResult` is: the caller is the HTTP
 * handler, which needs a status code and gets a plain `Error` across the RPC boundary.
 */
export type WidgetAssetResult =
  | {
      ok: true;
      bytes: Uint8Array;
      mimeType: string;
      path: string;
      visibility: ProjectFileVisibility;
      principal: WidgetPrincipal;
      /** A fresh capability to put in the caller's cookie, for a caller who presented one. */
      renewedToken?: string;
    }
  | { ok: false; status: number; message: string };

/** Everything needed to run one widget's backend for one request, and nothing more. */
export type WidgetBackendResult =
  | {
      ok: true;
      widgetId: string;
      projectId: string;
      name: string;
      visibility: ProjectFileVisibility;
      principal: WidgetPrincipal;
      /** The backend module's source. */
      source: string;
      /** The project's shared configuration, values included: this is the widget's environment. */
      envVars: Record<string, string>;
      /** Changes whenever the module or the configuration does, so a stale isolate is not reused. */
      revision: string;
      renewedToken?: string;
    }
  | { ok: false; status: number; message: string };

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

type WidgetRow = {
  widget_id: string;
  name: string;
  path: string;
  description: string;
  visibility: string;
  owner_id: string;
  created: number;
  updated: number;
};

type WidgetFileRow = {
  widget_id: string;
  path: string;
  mime_type: string;
  size: number;
  content_key: string;
  updated: number;
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
CREATE TABLE IF NOT EXISTS widgets (
  widget_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS widgets_by_owner ON widgets (owner_id);
CREATE TABLE IF NOT EXISTS widget_files (
  widget_id TEXT NOT NULL,
  path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  content_key TEXT NOT NULL,
  updated INTEGER NOT NULL,
  PRIMARY KEY (widget_id, path)
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
      sql += " AND path LIKE ? ESCAPE '\\'";
      bindings.push(`${likeLiteral(opts.pathPrefix)}%`);
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
    this.#enforceQuota(plan.size, target);
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
    // Again, against what the project holds now. Two writes planned while there was room for either
    // one of them would both have passed the check the agent saw.
    this.#enforceQuota(write.size, existing);
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

  /**
   * Remove a comment, which only its author may do.
   *
   * There is no API for this: it exists so that undoing an approved `addComment` can take the
   * comment back. Undoing your own comment is the only case, so authorship is the whole rule -- a
   * project owner moderates by resolving a thread or deleting the file, not by editing the record of
   * what someone said.
   */
  async deleteComment(memberId: string, commentId: string): Promise<void> {
    this.#requireMember(memberId);
    const comment = this.#comment(commentId);
    if (!comment) return;
    if (comment.author_id !== memberId) {
      throw new ProjectError("Only a comment's author can delete it.", 403);
    }
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
  // Widgets
  //
  // A widget answers to the same rules a file does, deliberately: `canRead` decides who may open
  // it, `canWrite` decides who may change it, `canDelete` lets a project owner moderate. What is
  // different is that a widget is opened over HTTP by a browser rather than read over RPC by an
  // agent, so this section also holds the two methods that decide without a member id in hand --
  // `fetchWidgetAsset` and `openWidgetBackend` -- and both of them re-derive the caller's standing
  // from current state on every single request.

  async listWidgets(memberId: string, opts: { limit: number }): Promise<ProjectWidgetSummary[]> {
    const member = this.#requireMember(memberId);
    return this.ctx.storage.sql.exec<WidgetRow>(
      "SELECT * FROM widgets ORDER BY updated DESC").toArray()
      .filter((row) => canRead(row.visibility as ProjectFileVisibility, row.owner_id,
                               { memberId: member.member_id, isMember: true }))
      .slice(0, opts.limit)
      .map((row) => this.#summarizeWidget(row, memberId));
  }

  async statWidget(memberId: string, widgetId: string): Promise<ProjectWidgetSummary> {
    return this.#summarizeWidget(this.#readableWidget(memberId, widgetId), memberId);
  }

  /**
   * What creating a widget would produce, without creating it.
   *
   * The same plan/commit split file writes use, and for the same reason: a name already taken is
   * something the agent can fix now, and a human should not be asked about a widget that was never
   * going to exist.
   */
  async planWidget(memberId: string, plan: {
    path: string;
    visibility?: ProjectFileVisibility;
  }): Promise<{ widgetId: string; visibility: ProjectFileVisibility }> {
    this.#requireMember(memberId);
    if (this.#widgetByPath(plan.path)) {
      throw new ProjectError(`${plan.path} is already taken by another widget.`, 409);
    }
    if (this.#rowByPath(plan.path)) {
      throw new ProjectError(`${plan.path} is already taken by a file.`, 409);
    }
    return {
      widgetId: newId(),
      visibility: plan.visibility ?? defaultVisibility(plan.path),
    };
  }

  async commitWidget(memberId: string, widget: StagedWidget): Promise<ProjectWidgetSummary> {
    this.#requireMember(memberId);
    if (this.#widget(widget.widgetId)) {
      throw new ProjectError("That widget already exists.", 409);
    }
    const occupant = this.#widgetByPath(widget.path);
    if (occupant) throw new ProjectError(`${widget.path} is already taken.`, 409);
    const now = Date.now();
    this.ctx.storage.sql.exec(
      "INSERT INTO widgets (widget_id, name, path, description, visibility, owner_id, created, " +
      "updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      widget.widgetId, widget.name, widget.path, widget.description, widget.visibility, memberId,
      now, now);
    return this.#summarizeWidget(this.#requireWidget(widget.widgetId), memberId);
  }

  /** What a write to one of a widget's files would cost, and what it would replace. */
  async planWidgetFile(memberId: string, widgetId: string, plan: {
    path: string;
    size: number;
  }): Promise<{ replacesContentKey?: string }> {
    this.#requireMember(memberId);
    const widget = this.#writableWidget(memberId, widgetId);
    const existing = this.#widgetFile(widget.widget_id, plan.path);
    this.#enforceQuota(plan.size, existing);
    return existing ? { replacesContentKey: existing.content_key } : {};
  }

  async commitWidgetFile(
    memberId: string,
    write: StagedWidgetFile,
  ): Promise<ProjectWidgetFile> {
    this.#requireMember(memberId);
    const widget = this.#writableWidget(memberId, write.widgetId);
    const existing = this.#widgetFile(widget.widget_id, write.path);
    // Again against what the project holds now: approval takes as long as a person takes.
    this.#enforceQuota(write.size, existing);
    const now = Date.now();
    this.ctx.storage.sql.exec(
      "INSERT INTO widget_files (widget_id, path, mime_type, size, content_key, updated) " +
      "VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (widget_id, path) DO UPDATE SET " +
      "mime_type = excluded.mime_type, size = excluded.size, content_key = excluded.content_key, " +
      "updated = excluded.updated",
      write.widgetId, write.path, write.mimeType, write.size, write.contentKey, now);
    this.ctx.storage.sql.exec(
      "UPDATE widgets SET updated = ? WHERE widget_id = ?", now, write.widgetId);
    if (existing && existing.content_key !== write.contentKey) {
      await this.#deleteObject(existing.content_key);
    }
    return toWidgetFile(this.#requireWidgetFile(write.widgetId, write.path));
  }

  async listWidgetFiles(memberId: string, widgetId: string): Promise<ProjectWidgetFile[]> {
    const widget = this.#readableWidget(memberId, widgetId);
    return this.#widgetFiles(widget.widget_id).map(toWidgetFile);
  }

  async readWidgetFile(
    memberId: string,
    widgetId: string,
    path: string,
  ): Promise<ProjectWidgetFileContent> {
    const widget = this.#readableWidget(memberId, widgetId);
    const row = this.#widgetFile(widget.widget_id, path);
    if (!row) throw notFound(`${path} in that widget`);
    return {
      ...toWidgetFile(row),
      content: encodeContent(await this.#widgetBytes(widget, row), row.mime_type),
    };
  }

  async deleteWidgetFile(memberId: string, widgetId: string, path: string): Promise<void> {
    this.#requireMember(memberId);
    const widget = this.#writableWidget(memberId, widgetId);
    const row = this.#widgetFile(widget.widget_id, path);
    if (!row) return;
    this.ctx.storage.sql.exec(
      "DELETE FROM widget_files WHERE widget_id = ? AND path = ?", widget.widget_id, path);
    this.ctx.storage.sql.exec(
      "UPDATE widgets SET updated = ? WHERE widget_id = ?", Date.now(), widget.widget_id);
    await this.#deleteObject(row.content_key);
  }

  /** Move a widget, taking the visibility its new path implies. Public survives the move. */
  async moveWidget(
    memberId: string,
    widgetId: string,
    path: string,
  ): Promise<ProjectWidgetSummary> {
    this.#requireMember(memberId);
    const widget = this.#writableWidget(memberId, widgetId);
    const occupant = this.#widgetByPath(path);
    if (occupant && occupant.widget_id !== widget.widget_id) {
      throw new ProjectError(`${path} is already taken.`, 409);
    }
    this.ctx.storage.sql.exec(
      "UPDATE widgets SET path = ?, visibility = ?, updated = ? WHERE widget_id = ?",
      path, visibilityAfterMove(widget.visibility as ProjectFileVisibility, path), Date.now(),
      widget.widget_id);
    return this.#summarizeWidget(this.#requireWidget(widget.widget_id), memberId);
  }

  async setWidgetVisibility(
    memberId: string,
    widgetId: string,
    visibility: ProjectFileVisibility,
  ): Promise<ProjectWidgetSummary> {
    this.#requireMember(memberId);
    const widget = this.#writableWidget(memberId, widgetId);
    this.ctx.storage.sql.exec(
      "UPDATE widgets SET visibility = ?, updated = ? WHERE widget_id = ?",
      visibility, Date.now(), widget.widget_id);
    return this.#summarizeWidget(this.#requireWidget(widget.widget_id), memberId);
  }

  /**
   * Delete a widget and everything it served. Its owner may; a project owner may, to moderate.
   *
   * Reports whether the widget existed, so the caller can decide whether to throw away the widget's
   * own store -- which lives in a different Durable Object and is not this object's to reach.
   */
  async deleteWidget(memberId: string, widgetId: string): Promise<{ deleted: boolean }> {
    const member = this.#requireMember(memberId);
    const widget = this.#widget(widgetId);
    if (!widget) return { deleted: false };
    if (!canDelete(widget.owner_id, { memberId, role: member.role as ProjectRole })) {
      throw new ProjectError(
        `The widget ${widget.path} belongs to another member, so only they or a project owner can ` +
        `delete it.`, 403);
    }
    const files = this.#widgetFiles(widgetId);
    this.ctx.storage.sql.exec("DELETE FROM widget_files WHERE widget_id = ?", widgetId);
    this.ctx.storage.sql.exec("DELETE FROM widgets WHERE widget_id = ?", widgetId);
    for (const file of files) await this.#deleteObject(file.content_key);
    return { deleted: true };
  }

  /**
   * A link that opens a widget: stable for a public one, short-lived and signed for every other.
   *
   * The token names the widget and the member it was minted for, so it proves only that this member
   * could open this widget when it was signed. Whether they still can is decided again on every
   * request the browser makes with it.
   */
  async mintWidgetLink(
    memberId: string,
    widgetId: string,
  ): Promise<{ url: string; expires: string | null }> {
    const widget = this.#readableWidget(memberId, widgetId);
    const url = widgetUrl(this.env, this.#requireProject().project_id, widget.widget_id);
    if (widget.visibility === "public") return { url, expires: null };
    const token = await this.#mintWidgetToken(widget.widget_id, memberId);
    return {
      url: `${url}?t=${encodeURIComponent(token.token)}`,
      expires: new Date(token.expires).toISOString(),
    };
  }

  /**
   * One of a widget's files, for the Worker's HTTP route.
   *
   * No member identity arrives with an HTTP request, so the caller's standing is worked out here,
   * from the token they presented and from what the widget's visibility and the project's membership
   * say right now. That is the whole point of deciding it here rather than once at link time: an
   * owner who makes a widget private again has cut off every cookie already in a browser.
   */
  async fetchWidgetAsset(
    widgetId: string,
    tokens: readonly string[],
    assetPath: string,
  ): Promise<WidgetAssetResult> {
    const opened = await this.#openWidget(widgetId, tokens);
    if (!opened.ok) return opened;
    const { widget, principal, renewedToken } = opened;
    const path = widgetAssetPath(assetPath);
    // The backend module is code, not an asset: serving it would hand its source, and anything it
    // has inlined, to everyone who can open the widget.
    if (path === WIDGET_BACKEND_PATH) {
      const refused = notFound("That file");
      return { ok: false, status: refused.status, message: refused.message };
    }
    const row = this.#widgetFile(widget.widget_id, path);
    if (!row) {
      const refused = notFound(`${path} in that widget`);
      return { ok: false, status: refused.status, message: refused.message };
    }
    try {
      return {
        ok: true,
        bytes: await this.#widgetBytes(widget, row),
        mimeType: row.mime_type,
        path: row.path,
        visibility: widget.visibility as ProjectFileVisibility,
        principal,
        ...(renewedToken ? { renewedToken } : {}),
      };
    } catch (error) {
      const failure = error instanceof ProjectError ? error : new ProjectError(String(error), 500);
      return { ok: false, status: failure.status, message: failure.message };
    }
  }

  /**
   * What a widget's backend needs to answer one request.
   *
   * The environment is assembled here rather than in the handler because this object is the only
   * one that may read a project's shared configuration, and because the decision about who is
   * asking has to be made in the same breath as the decision about what they get. Note what is not
   * in the answer: no R2 keys, no other members' files, no token belonging to whoever is browsing.
   */
  async openWidgetBackend(
    widgetId: string,
    tokens: readonly string[],
  ): Promise<WidgetBackendResult> {
    const opened = await this.#openWidget(widgetId, tokens);
    if (!opened.ok) return opened;
    const { widget, principal, renewedToken } = opened;
    const backend = this.#widgetFile(widget.widget_id, WIDGET_BACKEND_PATH);
    if (!backend) {
      return {
        ok: false,
        status: 404,
        message: `The widget ${widget.name} has no backend, so it answers nothing under api/.`,
      };
    }
    try {
      const source = new TextDecoder().decode(await this.#widgetBytes(widget, backend));
      const vars = this.ctx.storage.sql.exec<{ name: string; value: string; updated: number }>(
        "SELECT name, value, updated FROM env_vars ORDER BY name").toArray();
      return {
        ok: true,
        widgetId: widget.widget_id,
        projectId: this.#requireProject().project_id,
        name: widget.name,
        visibility: widget.visibility as ProjectFileVisibility,
        principal,
        source,
        envVars: Object.fromEntries(vars.map((row) => [row.name, row.value])),
        // Enough to notice any change that should retire a running isolate: the module itself, and
        // the configuration it was built with.
        revision: `${backend.content_key}.${vars.length}.${
          vars.reduce((latest, row) => Math.max(latest, row.updated), 0)}`,
        ...(renewedToken ? { renewedToken } : {}),
      };
    } catch (error) {
      const failure = error instanceof ProjectError ? error : new ProjectError(String(error), 500);
      return { ok: false, status: failure.status, message: failure.message };
    }
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
    if (parsed.kind === "widget") {
      const widget = this.#widget(parsed.widgetId);
      if (!widget) return false;
      return canRead(widget.visibility as ProjectFileVisibility, widget.owner_id,
                     { memberId, isMember: true });
    }
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
    return {
      maxFileBytes: configuredCount(
        this.env.PROJECT_MAX_FILE_BYTES, DEFAULT_QUOTA.maxFileBytes),
      maxProjectBytes: configuredCount(
        this.env.PROJECT_MAX_TOTAL_BYTES, DEFAULT_QUOTA.maxProjectBytes),
      maxFileCount: configuredCount(
        this.env.PROJECT_MAX_FILE_COUNT, DEFAULT_QUOTA.maxFileCount),
    };
  }

  /**
   * What this project may hold, checked against a write of `size` replacing `existing`.
   *
   * Run when a write is planned and again when it commits. Planning is what tells an agent its file
   * is too big while it can still do something about it; committing is the check that holds, because
   * approval takes as long as a person takes and the project may have filled up in between.
   */
  #enforceQuota(size: number, existing: { size: number } | undefined): void {
    const quota = this.#quota();
    if (size > quota.maxFileBytes) {
      throw new ProjectError(
        `That file is ${size} bytes; this deployment allows at most ${quota.maxFileBytes}.`);
    }
    const totals = this.#totals();
    // An overwrite pays only the difference: the bytes it replaces are released with it.
    if (totals.bytes - (existing?.size ?? 0) + size > quota.maxProjectBytes) {
      throw new ProjectError(
        `This project holds ${totals.bytes} of ${quota.maxProjectBytes} allowed bytes; ` +
        `that file does not fit.`);
    }
    if (!existing && totals.count >= quota.maxFileCount) {
      throw new ProjectError(
        `This project already holds its limit of ${quota.maxFileCount} files.`);
    }
  }

  /**
   * What this project holds, files and widget files together.
   *
   * One total rather than two, because the quota is a statement about what a deployment is paying
   * for and the bytes of a widget's `index.html` cost exactly what the bytes of a document cost.
   * Splitting them would give a member a second allowance nobody decided to grant.
   */
  #totals(): { count: number; bytes: number } {
    const row = this.ctx.storage.sql.exec<{ count: number; bytes: number }>(
      "SELECT (SELECT COUNT(*) FROM files) + (SELECT COUNT(*) FROM widget_files) AS count, " +
      "COALESCE((SELECT SUM(size) FROM files), 0) + " +
      "COALESCE((SELECT SUM(size) FROM widget_files), 0) AS bytes").one();
    return { count: row.count, bytes: row.bytes };
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

  #widget(widgetId: string): WidgetRow | undefined {
    return this.ctx.storage.sql.exec<WidgetRow>(
      "SELECT * FROM widgets WHERE widget_id = ?", widgetId).toArray()[0];
  }

  #requireWidget(widgetId: string): WidgetRow {
    const widget = this.#widget(widgetId);
    if (!widget) throw notFound("That widget");
    return widget;
  }

  #widgetByPath(path: string): WidgetRow | undefined {
    return this.ctx.storage.sql.exec<WidgetRow>(
      "SELECT * FROM widgets WHERE path = ?", path).toArray()[0];
  }

  #readableWidget(memberId: string, widgetId: string): WidgetRow {
    const widget = this.#requireWidget(widgetId);
    const allowed = canRead(widget.visibility as ProjectFileVisibility, widget.owner_id,
                            { memberId, isMember: this.#member(memberId) !== undefined });
    if (!allowed) throw notFound("That widget");
    return widget;
  }

  /**
   * A widget this member may change, which is only one of their own.
   *
   * The same rule files have, and the same reason: a project is a place to publish your own work
   * and comment on other people's. A member who wants a different widget builds their own.
   */
  #writableWidget(memberId: string, widgetId: string): WidgetRow {
    const widget = this.#readableWidget(memberId, widgetId);
    if (!canWrite(widget.owner_id, memberId)) {
      throw new ProjectError(
        `The widget ${widget.path} belongs to another member and only its owner can change it.`,
        403);
    }
    return widget;
  }

  #widgetFiles(widgetId: string): WidgetFileRow[] {
    return this.ctx.storage.sql.exec<WidgetFileRow>(
      "SELECT * FROM widget_files WHERE widget_id = ? ORDER BY path", widgetId).toArray();
  }

  #widgetFile(widgetId: string, path: string): WidgetFileRow | undefined {
    return this.ctx.storage.sql.exec<WidgetFileRow>(
      "SELECT * FROM widget_files WHERE widget_id = ? AND path = ?", widgetId, path).toArray()[0];
  }

  #requireWidgetFile(widgetId: string, path: string): WidgetFileRow {
    const row = this.#widgetFile(widgetId, path);
    if (!row) throw notFound(`${path} in that widget`);
    return row;
  }

  #summarizeWidget(row: WidgetRow, memberId: string): ProjectWidgetSummary {
    const owner = this.#member(row.owner_id);
    const files = this.#widgetFiles(row.widget_id);
    return {
      widgetId: row.widget_id,
      name: row.name,
      path: row.path,
      description: row.description,
      visibility: row.visibility as ProjectFileVisibility,
      ownerId: row.owner_id,
      ownerName: owner?.display_name ?? "",
      writable: canWrite(row.owner_id, memberId),
      fileCount: files.length,
      size: files.reduce((total, file) => total + file.size, 0),
      hasBackend: files.some((file) => file.path === WIDGET_BACKEND_PATH),
      updated: new Date(row.updated).toISOString(),
      url: widgetUrl(this.env, this.#requireProject().project_id, row.widget_id),
    };
  }

  async #widgetBytes(widget: WidgetRow, row: WidgetFileRow): Promise<Uint8Array> {
    const object = await this.env.PROJECT_FILES.get(row.content_key);
    if (!object) {
      throw new ProjectError(
        `${row.path} in the widget ${widget.path} has metadata but no stored contents. ` +
        `Write it again.`, 410);
    }
    return new Uint8Array(await object.arrayBuffer());
  }

  /**
   * Who is asking for a widget, decided from scratch.
   *
   * Both HTTP entry points start here, so both apply the same three-step answer for each capability
   * offered: is the token real, is the member it names still a member, and does the widget's
   * visibility right now let them in. Every token failing that falls through to the public question
   * rather than refusing outright, so a stale cookie left over from a private spell does not break
   * a widget that has since been published.
   */
  async #openWidget(widgetId: string, tokens: readonly string[]): Promise<
    | { ok: true; widget: WidgetRow; principal: WidgetPrincipal; renewedToken?: string }
    | { ok: false; status: number; message: string }
  > {
    const widget = this.#widget(widgetId);
    if (widget) {
      for (const token of tokens) {
        const claimed = await this.#verifyWidgetToken(widgetId, token);
        const member = claimed ? this.#member(claimed) : undefined;
        if (!claimed || !member) continue;
        const allowed = canRead(widget.visibility as ProjectFileVisibility, widget.owner_id,
                                { memberId: claimed, isMember: true });
        if (!allowed) continue;
        // Renewed on every request, which is safe precisely because every request is re-checked: an
        // open widget stays open while the browser keeps using it, and closes the moment the answer
        // above changes.
        const renewed = await this.#mintWidgetToken(widgetId, claimed);
        return {
          ok: true,
          widget,
          principal: { kind: "member", memberId: claimed, role: member.role as ProjectRole },
          renewedToken: renewed.token,
        };
      }
      if (widget.visibility === "public") {
        return { ok: true, widget, principal: { kind: "public" } };
      }
    }
    const refused = notFound("That widget");
    return { ok: false, status: refused.status, message: refused.message };
  }

  async #mintWidgetToken(
    widgetId: string,
    memberId: string,
  ): Promise<{ token: string; expires: number }> {
    const expires = Date.now() + LINK_LIFETIME_MS;
    const signature = await this.#sign(widgetTokenPayload(widgetId, memberId, expires));
    return {
      token: `${encodeURIComponent(memberId)}.${expires}.${signature}`,
      expires,
    };
  }

  /** The member a widget token still vouches for, or null. */
  async #verifyWidgetToken(widgetId: string, token: string): Promise<string | null> {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [subject, expiresText, signature] = parts;
    const expires = Number(expiresText);
    if (!subject || !signature || !Number.isSafeInteger(expires) || expires <= Date.now()) {
      return null;
    }
    let memberId: string;
    try {
      memberId = decodeURIComponent(subject);
    } catch {
      return null;
    }
    // The widget id is inside the signed payload, so a cookie or token from one widget proves
    // nothing about another even though both were signed by this same project.
    const expected = await this.#sign(widgetTokenPayload(widgetId, memberId, expires));
    return timingSafeEqual(signature, expected) ? memberId : null;
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

/**
 * A path, as the literal part of a LIKE pattern.
 *
 * SQLite has no escape character unless the query names one, so the pattern this feeds is matched
 * with `ESCAPE '\'`; without that clause these backslashes would themselves be literal, and a folder
 * called `my_dir` would match nothing.
 */
function likeLiteral(path: string): string {
  return path.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

/**
 * A quota from a `var`, which arrives as a string.
 *
 * Anything unusable falls back rather than throwing: a deployment with a mistyped var should hold to
 * the documented limit, not refuse every write with a message about its own configuration. The
 * deploy script rejects the mistake where someone can still fix it.
 */
function configuredCount(value: unknown, fallback: number): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : fallback;
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

/**
 * What a widget token signs over.
 *
 * Prefixed so that no widget token can ever be a valid file token or the reverse: both are HMACs
 * over the same project key, and the prefix is what keeps the two vocabularies apart.
 */
function widgetTokenPayload(widgetId: string, memberId: string, expires: number): string {
  return `w.${widgetId}.${memberId}.${expires}`;
}

function toWidgetFile(row: WidgetFileRow): ProjectWidgetFile {
  return {
    path: row.path,
    mimeType: row.mime_type,
    size: row.size,
    updated: new Date(row.updated).toISOString(),
  };
}

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
