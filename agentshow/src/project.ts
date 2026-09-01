import { DurableObject } from "cloudflare:workers";
import {
  SCHEMA,
  type ActivityRow,
  type ActivityVerb,
  type FileComment,
  type FileRow,
  type FileSummary,
  type Member,
  type MemberKind,
  type SessionIndexEntry,
  type SessionStatus,
  type WriteInput,
  type WriteResult
} from "./project-schema";

/**
 * 一个 project 的公共区。
 *
 * 写入用乐观并发：调用方带上读到的版本号，不匹配就拒绝。
 * 这里没有三方合并 —— agent 干活是长事务，它脑子里的快照会在几十秒里失效，
 * 乐观并发把「静默覆盖别人的活」变成一次显式拒绝。
 */
export class ProjectDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(SCHEMA);
  }

  readFile(path: string): { content: string; version: number } | null {
    const row = this.ctx.storage.sql
      .exec<Pick<FileRow, "content" | "version">>(
        "SELECT content, version FROM files WHERE path = ?",
        path
      )
      .toArray()[0];
    return row ? { content: row.content, version: row.version } : null;
  }

  listFiles(): FileSummary[] {
    return this.ctx.storage.sql
      .exec<Omit<FileRow, "content">>(
        "SELECT path, version, owner_id, updated_at FROM files ORDER BY updated_at DESC"
      )
      .toArray()
      .map((r) => ({
        path: r.path,
        version: r.version,
        ownerId: r.owner_id,
        updatedAt: r.updated_at
      }));
  }

  writeFile(input: WriteInput): WriteResult {
    const current = this.readFile(input.path);
    const currentVersion = current?.version ?? 0;

    if (input.baseVersion !== currentVersion) {
      // 记下这次撞车。没有这条，乐观并发在界面上就完全看不见了 ——
      // 活动流只会剩一条平淡的「写入 v3」，把整个故事吃掉。
      this.#record({
        actorId: input.authorId,
        verb: "rejected",
        targetType: "file",
        targetId: input.path,
        // 两个版本号，界面拿它拼「手上是 v1，公共区已经是 v2」。
        detail: `v${input.baseVersion}→v${currentVersion}`
      });
      return {
        ok: false,
        reason: "stale",
        version: currentVersion,
        content: current?.content ?? ""
      };
    }

    const next = currentVersion + 1;
    const now = Date.now();

    // owner_id 只在 INSERT 时写，UPDATE 不碰它 —— 文件归属属于创建者，
    // 别人改它不夺走归属。Files 列表上那个头像回答的是「这是谁的东西」，
    // 不是「谁最后碰过」。
    this.ctx.storage.sql.exec(
      `INSERT INTO files (path, content, version, owner_id, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET
         content    = excluded.content,
         version    = excluded.version,
         updated_at = excluded.updated_at`,
      input.path,
      input.content,
      next,
      input.authorId,
      now
    );

    this.#record({
      actorId: input.authorId,
      verb: next === 1 ? "created" : "updated",
      targetType: "file",
      targetId: input.path,
      detail: `v${next}`
    });

    return { ok: true, version: next };
  }

  // ── 活动流 ────────────────────────────────────────────────────────────

  /**
   * 只有登记为 human 的成员才是人。不在成员表里的作者按 agent 记 ——
   * agent 是从工具调用里冒出来的，可能还没被显式加进成员表；
   * 人类必须先通过 Access 登录、被加成成员才能操作，一定在表里。
   */
  #kindOf(actorId: string): MemberKind {
    const row = this.ctx.storage.sql
      .exec<{ kind: MemberKind }>(
        "SELECT kind FROM members WHERE member_id = ?",
        actorId
      )
      .toArray()[0];
    return row?.kind === "human" ? "human" : "agent";
  }

  #record(a: {
    actorId: string;
    verb: ActivityVerb;
    targetType: ActivityRow["targetType"];
    targetId: string;
    detail?: string;
  }): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO activity (actor_id, actor_kind, verb, target_type, target_id, detail, at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      a.actorId,
      this.#kindOf(a.actorId),
      a.verb,
      a.targetType,
      a.targetId,
      a.detail ?? null,
      Date.now()
    );
  }

  /**
   * `before` 给定时只返回比它更旧的行，用来往回翻。
   *
   * 不给上限而一次全取是不行的：活动流是这个 project 里最长的一张表。
   * 但只给一个硬窗口也不行 —— 那样界面会把「最近 50 条」当成全部历史
   * 展示出去，第 51 条之后的东西从所有筛选视图里永久消失。
   */
  listActivity(limit = 50, before?: number): ActivityRow[] {
    if (before !== undefined) {
      return this.#activityRows(
        `SELECT id, actor_id, actor_kind, verb, target_type, target_id, detail, at
         FROM activity WHERE id < ? ORDER BY id DESC LIMIT ?`,
        [before, limit]
      );
    }
    return this.#activityRows(
      `SELECT id, actor_id, actor_kind, verb, target_type, target_id, detail, at
       FROM activity ORDER BY id DESC LIMIT ?`,
      [limit]
    );
  }

  /** 还有没有比这条更旧的。界面拿它决定「更早的」这个入口出不出现。 */
  hasActivityBefore(id: number): boolean {
    return (
      this.ctx.storage.sql
        .exec<{ n: number }>(
          "SELECT COUNT(*) AS n FROM (SELECT id FROM activity WHERE id < ? LIMIT 1)",
          id
        )
        .toArray()[0].n > 0
    );
  }

  #activityRows(sql: string, params: unknown[]): ActivityRow[] {
    return this.ctx.storage.sql
      .exec<{
        id: number;
        actor_id: string;
        actor_kind: MemberKind;
        verb: ActivityVerb;
        target_type: ActivityRow["targetType"];
        target_id: string;
        detail: string | null;
        at: number;
      }>(sql, ...params)
      .toArray()
      .map((r) => ({
        id: r.id,
        actorId: r.actor_id,
        actorKind: r.actor_kind,
        verb: r.verb,
        targetType: r.target_type,
        targetId: r.target_id,
        detail: r.detail,
        at: r.at
      }));
  }

  /** 提及的活动记录由 deliverMention 在投递成功后调用。发起方可以是人。 */
  recordMention(m: { fromId: string; toAgentId: string; path: string }): void {
    this.#record({
      actorId: m.fromId,
      verb: "mentioned",
      targetType: "file",
      targetId: m.path,
      detail: m.toAgentId
    });
  }

  /**
   * 提及链撞上跳数上限。主语是**发起方** —— 是它的这一次投递被拦下的。
   *
   * detail 记要 @ 的那个名字：链条断在谁面前，是用户接手时第一个要知道的事。
   */
  recordMentionBlocked(m: {
    fromId: string;
    toAgentName: string;
    path: string;
  }): void {
    this.#record({
      actorId: m.fromId,
      verb: "blocked",
      targetType: "file",
      targetId: m.path,
      detail: m.toAgentName
    });
  }

  /** 被叫醒的那一轮推理挂了。主语是失败的那个 agent。 */
  recordTurnFailed(m: { agentId: string; detail?: string }): void {
    this.#record({
      actorId: m.agentId,
      verb: "failed",
      targetType: "session",
      targetId: m.agentId,
      detail: m.detail
    });
  }

  // ── 讨论线程 ──────────────────────────────────────────────────────────

  /**
   * 评论挂在路径上。fileVersion 取写入时文件的当前版本 ——
   * 文件不存在时是 0，可以先对一个还没建的文件提要求。
   */
  addComment(c: {
    path: string;
    authorId: string;
    text: string;
    anchor?: string;
  }): void {
    const file = this.readFile(c.path);
    this.ctx.storage.sql.exec(
      `INSERT INTO comments (path, author_id, text, anchor, file_version, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      c.path,
      c.authorId,
      c.text,
      c.anchor ?? null,
      file?.version ?? 0,
      Date.now()
    );

    this.#record({
      actorId: c.authorId,
      verb: "commented",
      targetType: "file",
      targetId: c.path,
      detail: c.anchor
    });
  }

  listComments(path: string): FileComment[] {
    return this.ctx.storage.sql
      .exec<{
        id: number;
        path: string;
        author_id: string;
        text: string;
        anchor: string | null;
        file_version: number;
        created_at: number;
      }>(
        `SELECT id, path, author_id, text, anchor, file_version, created_at
         FROM comments WHERE path = ? ORDER BY id ASC`,
        path
      )
      .toArray()
      .map((r) => ({
        id: r.id,
        path: r.path,
        authorId: r.author_id,
        text: r.text,
        anchor: r.anchor,
        fileVersion: r.file_version,
        createdAt: r.created_at
      }));
  }

  /**
   * Files 列表每一行都要显示评论数，所以一次查完，
   * 而不是让前端对每个文件各查一次。没有评论的文件不出现在结果里。
   */
  commentCounts(): Record<string, number> {
    const rows = this.ctx.storage.sql
      .exec<{ path: string; n: number }>(
        "SELECT path, COUNT(*) AS n FROM comments GROUP BY path"
      )
      .toArray();
    return Object.fromEntries(rows.map((r) => [r.path, r.n]));
  }

  // ── 成员 ──────────────────────────────────────────────────────────────

  /**
   * `by` 是把人拉进来的那个成员。给了就记一条 `joined` 活动。
   *
   * 可选是因为第一个人类成员是建 project 时自己进来的 —— 那一刻没有「谁拉的」，
   * 硬记一条「yrzhe 把 yrzhe 加进了这个项目」是噪音。
   */
  addMember(m: Member, by?: string): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO members (member_id, kind, name, joined_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(member_id) DO UPDATE SET kind = excluded.kind, name = excluded.name`,
      m.memberId,
      m.kind,
      m.name,
      Date.now()
    );

    if (by) {
      this.#record({
        actorId: by,
        verb: "joined",
        targetType: "member",
        targetId: m.memberId,
        detail: m.name
      });
    }
  }

  listMembers(): Member[] {
    return this.ctx.storage.sql
      .exec<{ member_id: string; kind: MemberKind; name: string }>(
        "SELECT member_id, kind, name FROM members ORDER BY joined_at ASC"
      )
      .toArray()
      .map((r) => ({ memberId: r.member_id, kind: r.kind, name: r.name }));
  }

  hasMember(id: string): boolean {
    return (
      this.ctx.storage.sql
        .exec<{ n: number }>(
          "SELECT COUNT(*) AS n FROM members WHERE member_id = ?",
          id
        )
        .toArray()[0].n > 0
    );
  }

  /**
   * id → 显示名。@提及的通知里出现的必须是名字：被叫醒的 agent 只有
   * 这一句话和那个文件，看到一个 id 它不知道是谁在叫它。
   */
  memberName(id: string): string | null {
    const row = this.ctx.storage.sql
      .exec<{ name: string }>("SELECT name FROM members WHERE member_id = ?", id)
      .toArray()[0];
    return row?.name ?? null;
  }

  /**
   * @提及 靠这个把名字变成 agentId。
   * 只解析 agent —— 人类不能被 @ 醒来干活，把人解析出来会让提及链路
   * 投递到一个不存在的 AgentDO。
   */
  resolveAgentByName(name: string): string | null {
    const row = this.ctx.storage.sql
      .exec<{ member_id: string }>(
        "SELECT member_id FROM members WHERE name = ? AND kind = 'agent' LIMIT 1",
        name
      )
      .toArray()[0];
    return row?.member_id ?? null;
  }

  // ── session 索引 ──────────────────────────────────────────────────────

  /**
   * 一个 (agent, project) 只有一条 session，所以这里是 upsert 而不是 insert。
   * title 和 status 都可选：只改状态时不该把标题冲掉。
   */
  upsertSession(e: {
    agentId: string;
    title?: string;
    status?: SessionStatus;
  }): void {
    const now = Date.now();
    this.ctx.storage.sql.exec(
      `INSERT INTO session_index (agent_id, title, status, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(agent_id) DO UPDATE SET
         title      = COALESCE(?, session_index.title),
         status     = COALESCE(?, session_index.status),
         updated_at = ?`,
      e.agentId,
      e.title ?? "",
      e.status ?? "in_progress",
      now,
      e.title ?? null,
      e.status ?? null,
      now
    );
  }

  listSessions(): SessionIndexEntry[] {
    return this.ctx.storage.sql
      .exec<{
        agent_id: string;
        title: string;
        status: SessionStatus;
        updated_at: number;
      }>(
        "SELECT agent_id, title, status, updated_at FROM session_index ORDER BY updated_at DESC"
      )
      .toArray()
      .map((r) => ({
        agentId: r.agent_id,
        title: r.title,
        status: r.status,
        updatedAt: r.updated_at
      }));
  }
}
