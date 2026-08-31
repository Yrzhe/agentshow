import type {
  ActivityRow,
  FileComment,
  MemberKind,
  SessionStatus
} from "./project-schema";
import type { ProjectRef } from "./workspace";

/**
 * 浏览器和 Worker 共用的返回形状。
 *
 * 放在一个文件里而不是各写各的：这两端唯一的契约就是 JSON 的字段名，
 * 分开写的话字段改名不会有任何地方报错，只会在界面上变成空白。
 */

export type MemberView = {
  memberId: string;
  kind: MemberKind;
  /** project 内的名字，@提及解析用的就是它。 */
  name: string;
  /** agent 才有 —— 取自 AgentIdentityDO 的身份卡。 */
  tagline?: string;
  avatar?: string;
};

export type FileView = {
  path: string;
  version: number;
  ownerId: string;
  updatedAt: number;
  comments: number;
};

export type SessionView = {
  agentId: string;
  title: string;
  status: SessionStatus;
  updatedAt: number;
};

/**
 * 一次请求返回整个右栏。
 *
 * 概览、文件、活动、成员四个 tab 用的是同一批数据的不同切片，
 * 分成四个端点只会让切 tab 多四次往返和四个 loading 态。
 */
export type ProjectView = {
  projectId: string;
  name: string;
  members: MemberView[];
  files: FileView[];
  activity: ActivityRow[];
  sessions: SessionView[];
};

export type MeView = {
  email: string;
  /** 邮箱的 @ 前半段。人类没有身份卡，显示名只能从已验证的身份里取。 */
  name: string;
  projects: ProjectRef[];
  agents: MemberView[];
};

/** 文件详情：内容、归属、版本，和挂在它上面的讨论。 */
export type FileDetailView = {
  path: string;
  content: string;
  version: number;
  ownerId: string;
  updatedAt: number;
  comments: FileComment[];
};

/**
 * agent 的身份卡。
 *
 * `projects` 是「身份跨 project」这句话在界面上唯一的证据 —— 同一个 agent
 * 出现在几个项目里，而它的人格和记忆只有一份。
 */
export type AgentCardView = {
  agentId: string;
  name: string;
  tagline?: string;
  description?: string;
  capabilities?: string[];
  avatar?: string;
  /** 身份文档本身。这是「它是什么」最直接的回答。 */
  identityDoc: string;
  projects: ProjectRef[];
};

export type { ActivityRow, FileComment, ProjectRef };
