import { Think } from "@cloudflare/think";
import { routeAgentRequest } from "agents";
import { DurableObject } from "cloudflare:workers";
import { verifyAccess } from "./access";

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
}

/** Task 2 才填内容。现在存在只是为了让 migration tag 一次定死。 */
export class ProjectDO extends DurableObject<Env> {}

export default {
  async fetch(request: Request, env: Env) {
    // 鉴权在最前面。WebSocket 握手也走这里 —— Access 会在握手请求上注入同一个头，
    // 所以放在 routeAgentRequest 之前就能同时挡住 HTTP 和 WS。
    const access = await verifyAccess(request, env, {
      isDev: import.meta.env.DEV
    });
    if (!access.ok) return access.response;

    // access.email 是已验证的人类身份，Task 4 接 members 表时从这里取。

    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;
