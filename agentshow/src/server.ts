import { Think } from "@cloudflare/think";
import type { Session, TurnConfig, TurnContext } from "@cloudflare/think";
import { routeAgentRequest } from "agents";
import type { ModelMessage } from "ai";
import { verifyAccess } from "./access";
import { handleApi } from "./api";
import { parseAgentKey } from "./agent-key";
import { projectTools } from "./agent-tools";
import { deliverMention } from "./mention";

export { AgentIdentityDO } from "./agent-identity";
export { ProjectDO } from "./project";
export { WorkspaceDO } from "./workspace";

/** DO storage 里存提及深度的键，加前缀避免跟 Agent 基类的键相撞。 */
const MENTION_DEPTH_KEY = "agentshow:mentionDepth";

/**
 * 这条 session 的标题，只在第一轮定一次。
 *
 * 存在自己这儿而不是每轮回 ProjectDO 读：这个 DO 就是这条 session，
 * 标题是它自己的属性。而且 ctx.messages 是截断过的，晚一点第一条用户
 * 消息会掉出窗口 —— 那时再取标题会取到中途的某句话。
 */
const SESSION_TITLE_KEY = "agentshow:sessionTitle";

/** 取第一条用户消息当标题。ModelMessage 的 content 可能是字符串也可能是分段。 */
function firstUserText(messages: ModelMessage[]): string {
  const m = messages.find((x) => x.role === "user");
  if (!m) return "";
  const text = (
    typeof m.content === "string"
      ? m.content
      : m.content.map((p) => (p.type === "text" ? p.text : "")).join("")
  ).trim();
  return text.length > 30 ? `${text.slice(0, 30)}…` : text;
}

export class AgentDO extends Think<Env> {
  // 默认开启的 bash 工具会快照上千个工作区文件，对这个产品是纯负担。
  workspaceBash = false;

  getModel() {
    // 字符串走 Think 内置的 workers-ai-provider，读 wrangler.jsonc 里的 AI 绑定。
    // 换外部 API 只需要改这一行 —— 刻意不做 provider 抽象层。
    return "@cf/moonshotai/kimi-k2.7-code";
  }

  /**
   * 这个 DO 实例代表一条 session，实例名是 `${agentId}:${projectId}`。
   * DM 的 project 位是保留字 dm。
   */
  get key() {
    return parseAgentKey(this.name);
  }

  #identity() {
    const { agentId } = this.key;
    return this.env.AgentIdentityDO.get(
      this.env.AgentIdentityDO.idFromName(agentId)
    );
  }

  /**
   * soul 和 memory 的 provider 指向 AgentIdentityDO —— 同一个 agent 在所有
   * project 里共享同一份身份和记忆，而每条 session 各自独立。
   *
   * 注意：一旦这里加了 context block，Think 就用它们组装 system prompt，
   * 不再调 getSystemPrompt()。人格的唯一来源是 AgentIdentityDO 里那份文档。
   */
  configureSession(session: Session) {
    const identity = this.#identity();
    return session
      .withContext("soul", {
        provider: { get: () => identity.getIdentityDoc() }
      })
      .withContext("memory", {
        description: "这个 agent 在使用中学到的东西",
        maxTokens: 1100,
        provider: { get: () => identity.getMemory() }
      })
      .withCachedPrompt();
  }

  // ── @提及的接收端 ──────────────────────────────────────────────────────

  /**
   * 被别的 agent @ 到时的入口。
   *
   * 用 submitMessages 而不是直接跑一轮：它是持久化的接收边界 —— 调用方
   * （提及的发起方）立刻返回，不等推理；带幂等键，同一条提及重投不会
   * 产生两条消息。目标 agent 不需要在线，DO 睡着也不丢。
   */
  async notifyMention(p: {
    fromId: string;
    /** 显示名。通知里出现 id 的话，被叫醒的 agent 不知道是谁在叫它。 */
    fromName: string;
    path: string;
    message: string;
    depth: number;
  }): Promise<void> {
    // 存下深度，供这一轮里它自己再 @ 别人时递增。
    await this.ctx.storage.put(MENTION_DEPTH_KEY, p.depth);

    // 被 @ 唤醒的 session 在这里定标题。不定的话，标题会从下面那段
    // 拼给模型的提示里截出来，会话列表上就是一行截断的机器话。
    if (!(await this.ctx.storage.get<string>(SESSION_TITLE_KEY))) {
      await this.ctx.storage.put(SESSION_TITLE_KEY, `被提及 · ${p.path}`);
    }

    const text = [
      `${p.fromName} 在文件 ${p.path} 上 @ 了你：`,
      p.message,
      "",
      `先用 readProjectFile 读 ${p.path}，再决定怎么回应。`
    ].join("\n");

    await this.submitMessages(
      [{ id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text }] }],
      {
        // 同一个人在同一个文件上说同一句话，重投不该变成两轮。
        // 用 id 不用名字：名字会改，改名不该让同一条提及重新投一遍。
        idempotencyKey: `mention:${p.fromId}:${p.path}:${p.message}`,
        metadata: { source: "mention", from: p.fromId, depth: p.depth }
      }
    );
  }

  /** 当前轮次所处的提及深度。人类发起的轮次是 0。 */
  async currentMentionDepth(): Promise<number> {
    return (await this.ctx.storage.get<number>(MENTION_DEPTH_KEY)) ?? 0;
  }

  /**
   * 轮次结束就把深度清掉。
   * 不清的话，人类的下一轮会读到上一条提及链留下的陈旧深度，
   * 于是一条正常的人类请求会被当成第 3 跳而拒绝再提及。
   */
  async onChatResponse(): Promise<void> {
    await this.ctx.storage.delete(MENTION_DEPTH_KEY);
  }

  /**
   * project 工具按轮注入，不放在 getTools() —— 后者没有参数，拿不到上下文。
   *
   * project 来自 DO 实例名，不是请求 body：客户端伪造不了实例名，但能伪造 body。
   * 走实例名等于把「这条 session 属于哪个 project」变成路由层的事实，
   * 而不是一个可以被请求方声称的值。
   *
   * DM 没有 project，就只有私有盘，没有公共区工具。
   */
  async beforeTurn(ctx: TurnContext): Promise<TurnConfig | void> {
    const { agentId, projectId } = this.key;
    if (!projectId) return;

    const project = this.env.ProjectDO.get(
      this.env.ProjectDO.idFromName(projectId)
    );

    // 让这条 session 出现在 project 的会话列表里。没有这一步，
    // 中栏永远是空的 —— 消息住在这个 DO 里，project 手里只有索引。
    let title = await this.ctx.storage.get<string>(SESSION_TITLE_KEY);
    if (!title) {
      title = firstUserText(ctx.messages);
      if (title) await this.ctx.storage.put(SESSION_TITLE_KEY, title);
    }
    await project.upsertSession({ agentId, title: title || undefined });

    return {
      tools: projectTools({
        project,
        authorId: agentId,
        mention: async (input) =>
          deliverMention(this.env, {
            projectId,
            fromId: agentId,
            toAgentName: input.toAgentName,
            path: input.path,
            message: input.message,
            // 当前深度 + 1 —— 我被 @ 到第 n 跳，我再 @ 别人就是第 n+1 跳。
            depth: (await this.currentMentionDepth()) + 1
          })
      })
    };
  }
}

export default {
  async fetch(request: Request, env: Env) {
    // 鉴权在最前面。WebSocket 握手也走这里 —— Access 会在握手请求上注入同一个头，
    // 所以放在 routeAgentRequest 之前就能同时挡住 HTTP 和 WS。
    const access = await verifyAccess(request, env, {
      isDev: import.meta.env.DEV
    });
    if (!access.ok) return access.response;

    // 界面的读写走这里，agent 的流式推理走 routeAgentRequest。
    // email 是验过的身份，作为参数传下去 —— 下游不再重新解析请求头。
    const apiResponse = await handleApi(request, env, access.email);
    if (apiResponse) return apiResponse;

    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) return agentResponse;

    // run_worker_first 是 true，静态资源也归 Worker 转发 —— 这样鉴权才覆盖首页和
    // JS bundle，而不只是 agent 端点。
    return env.ASSETS.fetch(request);
  }
} satisfies ExportedHandler<Env>;
