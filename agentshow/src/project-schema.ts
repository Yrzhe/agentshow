export const SCHEMA = `
CREATE TABLE IF NOT EXISTS files (
  path       TEXT PRIMARY KEY,
  content    TEXT NOT NULL,
  version    INTEGER NOT NULL,
  owner_id   TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

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
