import { DurableObject } from "cloudflare:workers";

/**
 * 一个人的工作台：他有哪些 project、他造了哪些 agent。
 *
 * 实例名是 Access 验过的邮箱。不另造 userId —— 鉴权已经给出了唯一身份，
 * 再发一个 id 只会多一张要对齐的映射表。
 *
 * 为什么需要这个 DO：ProjectDO 和 AgentIdentityDO 都按名字寻址，
 * 知道名字才能拿到实例。「我有哪些 project」这个问题在它们里面问不出来，
 * 必须有一处按人记账。
 *
 * 这里只记「有哪些」，不记「是什么」—— 名字、简介、头像住在
 * AgentIdentityDO，抄一份到这儿就会漂。
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  project_id TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
  agent_id   TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);
`;

export type ProjectRef = {
  projectId: string;
  name: string;
};

export class WorkspaceDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(SCHEMA);
  }

  /**
   * projectId 由调用方给，不在这里生成。
   *
   * 它同时是 ProjectDO 的实例名和 `${agentId}:${projectId}` 里的 project 位，
   * 所以必须是可读、可预测、能被 seed 脚本重复写入的值。随机 UUID 会让
   * 每次 seed 都长出一个新 project。
   */
  addProject(p: ProjectRef): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO projects (project_id, name, created_at) VALUES (?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET name = excluded.name`,
      p.projectId,
      p.name,
      Date.now()
    );
  }

  listProjects(): ProjectRef[] {
    return this.ctx.storage.sql
      .exec<{ project_id: string; name: string }>(
        "SELECT project_id, name FROM projects ORDER BY created_at ASC"
      )
      .toArray()
      .map((r) => ({ projectId: r.project_id, name: r.name }));
  }

  getProject(projectId: string): ProjectRef | null {
    const row = this.ctx.storage.sql
      .exec<{ project_id: string; name: string }>(
        "SELECT project_id, name FROM projects WHERE project_id = ?",
        projectId
      )
      .toArray()[0];
    return row ? { projectId: row.project_id, name: row.name } : null;
  }

  addAgent(agentId: string): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO agents (agent_id, created_at) VALUES (?, ?)
       ON CONFLICT(agent_id) DO NOTHING`,
      agentId,
      Date.now()
    );
  }

  listAgents(): string[] {
    return this.ctx.storage.sql
      .exec<{ agent_id: string }>(
        "SELECT agent_id FROM agents ORDER BY created_at ASC"
      )
      .toArray()
      .map((r) => r.agent_id);
  }
}
