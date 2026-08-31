import { parseAgentKey } from "./agent-key";

/**
 * agent 端点的归属闸。
 *
 * `routeAgentRequest` 之前**什么都不查**是一个完整的越权：Access 只回答
 * 「这个人能不能进这个站」，进来之后浏览器可以直接连
 * `/agents/agent-d-o/<任意实例名>`，而 AgentDO 会照着那个名字解析出
 * agentId / projectId 并把对应 project 的读写工具注入本轮。
 * 实测三个允许域里的任意登录者都能读别人的 session、驱动别人的 agent。
 *
 * 闸只有一条规则：实例名里的所有者必须等于 Access 验过的邮箱。
 * 前缀是路由层的事实，不是请求方可以声称的值。
 */

/**
 * agents SDK 的路径形状：`/agents/<namespace>/<instance-name>/...`
 *
 * 这是 SDK 唯一接受的形状（`routeAgentRequest` 转给 partyserver 的
 * `routePartykitRequest`，后者按 `/` 切分、过滤空段、固定取第 2、3 段，
 * 见 node_modules/partyserver/dist/index.js:482-508）。尾斜杠、重复斜杠、
 * 额外的 handler 子路径都只是同一种形状的等价写法。
 *
 * **下面的索引和 SDK 是耦合的。** `routeAgentRequest` 支持用 `options.prefix`
 * 换掉默认前缀，也支持多段前缀 —— 一旦那么做而这里不跟着改，
 * 实例名就会落在 parts[1] 以外，闸会去校验一个错误的段。
 * 当前没有传第三个参数，所以前缀就是单段的 agents。
 */
const AGENTS_PREFIX = "/agents/";

export type RouteCheck =
  | { kind: "not-agent" }
  | { kind: "ok" }
  | { kind: "deny"; response: Response };

export function checkAgentRoute(url: URL, email: string): RouteCheck {
  if (!url.pathname.startsWith(AGENTS_PREFIX)) return { kind: "not-agent" };

  const parts = url.pathname
    .slice(AGENTS_PREFIX.length)
    .split("/")
    .filter(Boolean);

  // <namespace>/<instance-name> 是最短形式。缺了就不是一条能路由的 agent 请求，
  // 交给 routeAgentRequest 自己去 404 —— 但不放行任何带实例名的请求。
  if (parts.length < 2) return { kind: "not-agent" };

  const key = parseAgentKey(decodeURIComponent(parts[1]));

  // 形状不对一律拒。老的裸 `${agentId}:${projectId}` 会落在这里 ——
  // 那正是要挡的东西，不是要兼容的东西。
  if (!key) return { kind: "deny", response: forbidden() };
  if (key.owner !== email) return { kind: "deny", response: forbidden() };

  return { kind: "ok" };
}

/**
 * 一律 403，不区分「实例名格式不对」和「这不是你的」。
 * 分开回会把「这个 agent 存在」这件事告诉不该知道的人。
 */
function forbidden(): Response {
  return new Response("无权访问这条 session", { status: 403 });
}
