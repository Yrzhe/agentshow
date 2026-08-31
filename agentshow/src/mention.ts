import { agentKey } from "./agent-key";

/**
 * @提及：让另一个 agent 动起来的唯一通道。
 *
 * 不做群聊，所以 agent 之间不共享消息流。投递是异步的：目标 agent 不需要在线，
 * DO 睡着也不丢。
 */

/**
 * 提及链的最大跳数。
 *
 * 不做群聊消除了广播风暴，但没有消除环 —— A @ B、B @ A 是个会一直烧钱的
 * 循环，而且在演示里撞上的概率不低。上限是包含的：depth === MAX 仍然放行，
 * 超过才拦。
 */
export const MAX_MENTION_DEPTH = 3;

export type MentionInput = {
  projectId: string;
  /**
   * 发起方。可以是 agent，也可以是人 —— 人在文件详情里 @ 一个 agent
   * 把活接过去，是这个产品的主要入口之一。
   */
  fromId: string;
  toAgentName: string;
  path: string;
  message: string;
  /** 当前这一轮所处的提及深度。人类发起的轮次是 0。 */
  depth: number;
};

export type MentionResult =
  | { ok: true; toAgentId: string }
  | { ok: false; reason: "max_depth" }
  | { ok: false; reason: "unknown_agent" };

export async function deliverMention(
  env: Env,
  input: MentionInput
): Promise<MentionResult> {
  if (input.depth > MAX_MENTION_DEPTH) {
    return { ok: false, reason: "max_depth" };
  }

  const project = env.ProjectDO.get(env.ProjectDO.idFromName(input.projectId));

  // 只解析 agent。人类没有 AgentDO，投递过去就是投进虚空 ——
  // 而且不会报错，表现为「agent 说我 @ 了它，然后什么都没发生」。
  const [toAgentId, fromName] = await Promise.all([
    project.resolveAgentByName(input.toAgentName),
    project.memberName(input.fromId)
  ]);
  if (!toAgentId) return { ok: false, reason: "unknown_agent" };

  const target = env.AgentDO.get(
    env.AgentDO.idFromName(agentKey(toAgentId, input.projectId))
  );

  await target.notifyMention({
    fromId: input.fromId,
    fromName: fromName ?? input.fromId,
    path: input.path,
    message: input.message,
    depth: input.depth
  });

  // 投递成功才记活动 —— 记在前面的话，被拒的提及也会出现在活动流里，
  // 界面上就成了「A 提及了 B」但 B 从没醒过。
  await project.recordMention({
    fromId: input.fromId,
    toAgentId,
    path: input.path
  });

  return { ok: true, toAgentId };
}
