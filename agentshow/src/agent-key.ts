/**
 * 一条 session 就是一个 AgentDO 实例，实例名是 `${agentId}:${projectId}`。
 *
 * 同一对 (agent, project) 确定性地映射到同一个 DO，所以不需要另造 sessionId ——
 * DO 实例名本身就是 session 的身份。DM 用保留字 `dm` 作为 project 位。
 */

const DM = "dm";

export function agentKey(agentId: string, projectId: string | null): string {
  return `${agentId}:${projectId ?? DM}`;
}

export function parseAgentKey(name: string): {
  agentId: string;
  projectId: string | null;
} {
  const i = name.indexOf(":");
  // 没有冒号的名字当 DM 处理，不抛异常 —— 路由层拿到什么名字不该由这里决定生死。
  if (i === -1) return { agentId: name, projectId: null };

  const agentId = name.slice(0, i);
  const rest = name.slice(i + 1);
  // 只按第一个冒号切，project id 里可以含冒号。
  return { agentId, projectId: rest === DM ? null : rest };
}
