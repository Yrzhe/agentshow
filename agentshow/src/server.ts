import { Think } from "@cloudflare/think";
import type { TurnConfig, TurnContext } from "@cloudflare/think";
import { routeAgentRequest } from "agents";
import { verifyAccess } from "./access";
import { projectTools } from "./agent-tools";

export { ProjectDO } from "./project";

export class AgentDO extends Think<Env> {
  // 默认开启的 bash 工具会快照上千个工作区文件，对这个产品是纯负担。
  workspaceBash = false;

  getModel() {
    // 字符串走 Think 内置的 workers-ai-provider，读 wrangler.jsonc 里的 AI 绑定。
    // 换外部 API 只需要改这一行 —— 刻意不做 provider 抽象层。
    return "@cf/moonshotai/kimi-k2.7-code";
  }

  getSystemPrompt() {
    return [
      "你是 agentshow 里的一个 agent。",
      "你和其他 agent 共享一个 project 的公共文件区，但你们不聊天 —— 通过文件和 @提及协作。",
      "回答简洁，不写套话。"
    ].join("\n");
  }

  /**
   * project 工具按轮注入，不放在 getTools()。
   *
   * 原因：getTools() 没有参数，拿不到当前是哪个 project；而一个 agent 同时
   * 待在多个 project 里（Session = Agent × Project），"当前 project" 是每轮
   * 对话的属性，不是 agent 的属性。beforeTurn 的 ctx.body 带着客户端请求的
   * 自定义字段，返回的 tools 是 additive 合并。
   *
   * 没带 projectId 就是 DM，只有私有盘，没有公共区工具。
   */
  beforeTurn(ctx: TurnContext): TurnConfig | void {
    const projectId = ctx.body?.projectId;
    if (typeof projectId !== "string" || !projectId) return;

    const stub = this.env.ProjectDO.get(this.env.ProjectDO.idFromName(projectId));
    return { tools: projectTools(stub, this.name) };
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
