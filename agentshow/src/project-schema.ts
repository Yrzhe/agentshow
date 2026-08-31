export const SCHEMA = `
CREATE TABLE IF NOT EXISTS files (
  path       TEXT PRIMARY KEY,
  content    TEXT NOT NULL,
  version    INTEGER NOT NULL,
  owner_id   TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 人和 agent 在同一张表里，靠 kind 区分。
-- 分成两张表就是在数据层宣告 agent 是二等公民，后面所有界面都会被拖回
-- 「人在协作，agent 是工具」。这是整个设计的支点。
CREATE TABLE IF NOT EXISTS members (
  member_id TEXT PRIMARY KEY,
  kind      TEXT NOT NULL CHECK (kind IN ('human', 'agent')),
  name      TEXT NOT NULL,
  joined_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS members_by_name ON members (name);

-- 只存指针不存内容。消息住在 AgentDO 里，project 手里只有索引 ——
-- 没有它，「这个项目现在什么状态」就得挨个 agent 问。
-- 一个 (agent, project) 只有一条 session，所以 agent_id 就是主键。
-- 讨论挂在文件路径上，不挂在对话上。
-- file_version 记下这条评论针对的是哪一版 —— 文件改过之后，
-- 界面要能区分「针对当前版本」和「老版本的遗留」。
-- 文件还不存在时记 0：可以先对一个还没建的文件提要求。
CREATE TABLE IF NOT EXISTS comments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  path         TEXT NOT NULL,
  author_id    TEXT NOT NULL,
  text         TEXT NOT NULL,
  anchor       TEXT,
  file_version INTEGER NOT NULL,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS comments_by_path ON comments (path, id);

CREATE TABLE IF NOT EXISTS session_index (
  agent_id   TEXT PRIMARY KEY,
  title      TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'in_progress'
             CHECK (status IN ('in_progress', 'done')),
  updated_at INTEGER NOT NULL
);
`;

export type MemberKind = "human" | "agent";

export type Member = {
  memberId: string;
  kind: MemberKind;
  name: string;
};

export type FileComment = {
  id: number;
  path: string;
  authorId: string;
  text: string;
  anchor: string | null;
  /** 这条评论针对的是文件哪一版。文件还不存在时为 0。 */
  fileVersion: number;
  createdAt: number;
};

export type SessionStatus = "in_progress" | "done";

export type SessionIndexEntry = {
  agentId: string;
  title: string;
  status: SessionStatus;
  updatedAt: number;
};

export type FileRow = {
  path: string;
  content: string;
  version: number;
  owner_id: string;
  updated_at: number;
};

export type FileSummary = {
  path: string;
  version: number;
  ownerId: string;
  updatedAt: number;
};

export type WriteInput = {
  path: string;
  content: string;
  /** 调用方读到这个文件时拿到的版本号。新文件传 0。 */
  baseVersion: number;
  authorId: string;
};

export type WriteResult =
  | { ok: true; version: number }
  /**
   * 拒绝时带回**当前**的内容和版本，不只是一句错误。
   * agent 拿到它就能直接在新内容上重做，不用再读一次 ——
   * 这个返回值的形状决定了乐观并发在模型手里成不成立。
   */
  | { ok: false; reason: "stale"; version: number; content: string };
