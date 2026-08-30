import { Think } from "@cloudflare/think";
import type { Session, TurnConfig, TurnContext } from "@cloudflare/think";
import { routeAgentRequest } from "agents";
import { verifyAccess } from "./access";
import { parseAgentKey } from "./agent-key";
import { projectTools } from "./agent-tools";

export { AgentIdentityDO } from "./agent-identity";
export { ProjectDO } from "./project";

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

  /**
   * project 工具按轮注入，不放在 getTools() —— 后者没有参数，拿不到上下文。
   *
   * project 来自 DO 实例名，不是请求 body：客户端伪造不了实例名，
   * 但能伪造 body。走实例名等于把"这条 session 属于哪个 project"
   * 变成路由层的事实，而不是一个可以被请求方声称的值。
   *
   * DM 没有 project，就只有私有盘，没有公共区工具。
   */
  beforeTurn(_ctx: TurnContext): TurnConfig | void {
    const { agentId, projectId } = this.key;
    if (!projectId) return;

    const stub = this.env.ProjectDO.get(this.env.ProjectDO.idFromName(projectId));
    return { tools: projectTools(stub, agentId) };
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

    // access.email 是已验证的人类身份，Task 4 接 members 表时从这里取。

    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) return agentResponse;

    // run_worker_first 是 true，静态资源也归 Worker 转发 —— 这样鉴权才覆盖首页和
    // JS bundle，而不只是 agent 端点。
    return env.ASSETS.fetch(request);
  }
} satisfies ExportedHandler<Env>;
