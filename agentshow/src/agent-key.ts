/**
 * DO 实例名的拼法。
 *
 * 每个实例名都带所有者前缀。**没有前缀的时候这里是个越权洞**：
 * ProjectDO 按 `idFromName(projectId)` 寻址、AgentIdentityDO 按 `idFromName(agentId)`
 * 寻址，而这两个 id 都是用户自己起的短 slug，于是两个人各建一个叫 `demo` 的
 * project 就共用同一个实例。实测可复现：B 用 A 的 projectId 调一次建 project，
 * 代码就把 B 加成了 A 那个 ProjectDO 的成员，之后 B 读得到 A 的文件。
 *
 * 所有者是 Cloudflare Access 验过的邮箱 —— 它不是请求里的字段，伪造不了。
 */

/**
 * 所有者和 slug 之间的分隔符。
 *
 * **不能用 `/`。** agents SDK 把实例名原样拼进 URL 路径且不编码，斜杠会变成
 * 真正的路径分隔符 —— 实测 `/agents/agent-d-o/dev@localhost/ferrule:x/get-messages`
 * 被切成多一段，路由拿到的名字是 `dev@localhost`，对话整个连不上
 * （SDK 自己也会警告 "room name contains forward slash"）。
 *
 * `~` 在 URL 里是 unreserved，不会被编码；slug 里不会出现它，
 * 所以按最后一个 `~` 切分即使邮箱里也有 `~` 也不会切错。
 */
const SCOPE_SEP = "~";

/** slug 的形状。冒号和分隔符都被挡在外面，下面的解析才成立。 */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * project 槽位的保留字：DM 用它表示「没有 project」。
 *
 * 它同时是一个合法 slug，所以一个真叫 `dm` 的 project 会和 DM 槽位
 * 拼出同一个实例名，而 parseAgentKey 会把它还原成 projectId: null ——
 * 那条 session 于是静默地拿不到任何 project 工具。建 project 时必须挡掉。
 */
export const DM_SLOT = "dm";

/** 能不能拿来当 project id。 */
export function isProjectId(slug: string): boolean {
  return SLUG_RE.test(slug) && slug !== DM_SLOT;
}

/**
 * `${owner}~${slug}` —— ProjectDO 和 AgentIdentityDO 的实例名。
 *
 * 用最后一个分隔符切分，不是第一个：邮箱里可以合法出现 `~`，而 slug 里不会。
 */
export function scoped(owner: string, slug: string): string {
  return `${owner}${SCOPE_SEP}${slug}`;
}

export function unscope(name: string): { owner: string; slug: string } {
  const cut = name.lastIndexOf(SCOPE_SEP);
  if (cut < 0) return { owner: "", slug: name };
  return { owner: name.slice(0, cut), slug: name.slice(cut + 1) };
}

/**
 * `${owner}~${agentId}:${projectId}` —— AgentDO 的实例名，一个实例就是一条 session。
 *
 * DM 没有 project，project 位是保留字 dm。
 */
export function agentKey(
  owner: string,
  agentId: string,
  projectId?: string
): string {
  return `${owner}${SCOPE_SEP}${agentId}:${projectId ?? DM_SLOT}`;
}

export type AgentKey = {
  owner: string;
  agentId: string;
  /** DM 时为 null。 */
  projectId: string | null;
};

/**
 * 解析实例名。形状不对就返回 null —— 调用方必须当成拒绝，不能当成默认值。
 *
 * 先按最后一个 `~` 切出 owner，再按剩下部分的第一个冒号切 agentId / projectId。
 * 顺序不能反：邮箱里可能有冒号，而分隔符之后的部分是两个 slug，两种符号都没有。
 */
export function parseAgentKey(name: string): AgentKey | null {
  const cut = name.lastIndexOf(SCOPE_SEP);
  if (cut <= 0) return null;

  const owner = name.slice(0, cut);
  const rest = name.slice(cut + 1);

  const colon = rest.indexOf(":");
  if (colon <= 0) return null;

  const agentId = rest.slice(0, colon);
  const projectSlot = rest.slice(colon + 1);

  if (!SLUG_RE.test(agentId)) return null;
  if (projectSlot !== DM_SLOT && !SLUG_RE.test(projectSlot)) return null;

  return {
    owner,
    agentId,
    projectId: projectSlot === DM_SLOT ? null : projectSlot
  };
}
