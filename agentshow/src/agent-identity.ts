import { DurableObject } from "cloudflare:workers";

/**
 * 一个 agent 跨所有 project 共享的部分：身份卡、身份文档、记忆。
 *
 * 为什么要单独一个 DO：Think 每个 DO 只管一条 session，而一条 session 只属于
 * 一个 project。身份和记忆要跨 project 活着，就不能待在会话所在的那个 DO 里。
 *
 * AgentDO 在 configureSession 里把 soul / memory 两个 context block 的 provider
 * 指到这里，同一 agent 的所有 session 于是共享同一份身份。
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS identity (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export type AgentProfile = {
  name: string;
  tagline: string;
  description?: string;
  capabilities?: string[];
  /**
   * 静态资源路径，如 `/avatars/ferrule.png`。
   *
   * 头像跟着身份走而不是跟着 project —— 同一个 agent 在哪个 project 里
   * 都该是同一张脸，否则活动流里认不出是谁。
   */
  avatar?: string;
};

/** 空的 soul 会让 agent 没有人格，所以给一个能用的兜底。 */
const DEFAULT_IDENTITY_DOC =
  "你是 agentshow 里的一个 agent。你和其他 agent 共享 project 的公共文件区，" +
  "但你们不聊天 —— 通过文件和 @提及协作。回答简洁，不写套话。";

export class AgentIdentityDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(SCHEMA);
  }

  #get(key: string): string | null {
    const row = this.ctx.storage.sql
      .exec<{ value: string }>("SELECT value FROM identity WHERE key = ?", key)
      .toArray()[0];
    return row?.value ?? null;
  }

  #set(key: string, value: string): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO identity (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      key,
      value
    );
  }

  getIdentityDoc(): string {
    return this.#get("soul") ?? DEFAULT_IDENTITY_DOC;
  }

  setIdentityDoc(doc: string): void {
    this.#set("soul", doc);
  }

  /** 返回空字符串而不是 null —— context provider 的契约是 string。 */
  getMemory(): string {
    return this.#get("memory") ?? "";
  }

  /** 追加不覆盖：记忆是长出来的，一次写入不该抹掉之前学到的东西。 */
  appendMemory(line: string): void {
    const now = this.getMemory();
    this.#set("memory", now ? `${now}\n${line}` : line);
  }

  setMemory(text: string): void {
    this.#set("memory", text);
  }

  getProfile(): AgentProfile {
    const raw = this.#get("profile");
    if (!raw) return { name: "", tagline: "" };
    return JSON.parse(raw) as AgentProfile;
  }

  setProfile(p: AgentProfile): void {
    this.#set("profile", JSON.stringify(p));
  }
}
