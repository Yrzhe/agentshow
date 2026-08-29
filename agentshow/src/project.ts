import { DurableObject } from "cloudflare:workers";
import {
  SCHEMA,
  type FileRow,
  type FileSummary,
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

    return { ok: true, version: next };
  }
}
