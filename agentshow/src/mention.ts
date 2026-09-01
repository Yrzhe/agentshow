import { agentKey, scoped } from "./agent-key";

/**
 * @提及：让另一个 agent 动起来的唯一通道。
 *
 * 不做群聊，所以 agent 之间不共享消息流。投递是异步的：目标 agent 不需要在线，
 * DO 睡着也不丢。
 */

/**
 * 提及链的最大跳数。上限是包含的：depth === MAX 仍然放行，超过才拦。
 *
 * 不做群聊消除了广播风暴，但没有消除环 —— A @ B、B @ A 是个会一直烧钱的
 * 循环，而且在演示里撞上的概率不低。
 *
 * 人发起的是第 0 跳，所以 agent 之间实际允许 3 跳：A→B→C→D，第 4 次投递被拦。
 */
export const MAX_MENTION_DEPTH = 3;

export type MentionInput = {
  /** Access 验过的所有者邮箱。所有 DO 实例名都带它做前缀。 */
  owner: string;
  projectId: string;
  /**
   * 发起方。可以是 agent，也可以是人 —— 人在文件详情里 @ 一个 agent
   * 把活接过去，是这个产品的主要入口之一。
   */
  fromId: string;
  toAgentName: string;
  path: string;
  message: string;
  /**
   * 这一轮所处的提及深度。人发起的是 0。
   *
   * **由服务端给，不由链条上的任何一方声称。** agent 那条路上，它取自
   * 正在执行的 submission 的 metadata（见 AgentDO.#currentDepth）；
   * 人那条路上，人不是任何提及的目标，所以恒为 0。
   */
  depth: number;
  /**
   * 这次提及动作的 id，用来做重投幂等。
   *
   * 不给就现生成一个，也就是「每次调用都是一次新的提及」。
   * 网络重试要复用同一条动作时必须显式传。
   */
  mentionId?: string;
};

export type MentionResult =
  | { ok: true; toAgentId: string; depth: number }
  | { ok: false; reason: "max_depth" }
  | { ok: false; reason: "unknown_agent" }
  /** 同一条提及被重投，目标没有新一轮。调用方不该据此宣称叫醒了谁。 */
  | { ok: false; reason: "duplicate"; toAgentId: string };

/**
 * 深度这件事写到第四版了，前三版分别栽在：
 *
 * 1. AgentDO 的跨轮单值键 —— 排队的两条提及互相覆盖。
 * 2. 消息正文里的一行标记 —— agent 复述通知能夹带，人手打能伪造。
 * 3. ProjectDO 的时间窗账本 —— 窗口替代不了链条身份：15 分钟内的另一条
 *    独立对话会继承旧链的深度被误拦，而排队超过窗口的真链又会被归零放行。
 *
 * 现在深度绑在**正在执行的那条 submission** 上（它的 metadata 由服务端写入）。
 * submission 就是「这一轮」本身，前三版都是它的近似。
 */
export async function deliverMention(
  env: Env,
  input: MentionInput
): Promise<MentionResult> {
  if (input.depth > MAX_MENTION_DEPTH) return { ok: false, reason: "max_depth" };

  const project = env.ProjectDO.get(
    env.ProjectDO.idFromName(scoped(input.owner, input.projectId))
  );

  // 只解析 agent。人类没有 AgentDO，投递过去就是投进虚空 ——
  // 而且不会报错，表现为「agent 说我 @ 了它，然后什么都没发生」。
  const [toAgentId, fromName] = await Promise.all([
    project.resolveAgentByName(input.toAgentName),
    project.memberName(input.fromId)
  ]);
  if (!toAgentId) return { ok: false, reason: "unknown_agent" };

  const target = env.AgentDO.get(
    env.AgentDO.idFromName(agentKey(input.owner, toAgentId, input.projectId))
  );

  const accepted = await target.notifyMention({
    fromId: input.fromId,
    fromName: fromName ?? input.fromId,
    path: input.path,
    message: input.message,
    depth: input.depth,
    mentionId: input.mentionId ?? crypto.randomUUID()
  });

  // 没被接受就是重投，目标没有新一轮 —— 这时候记活动会让界面上出现
  // 一条「A 提及了 B」而 B 从没醒过，正是这套东西最该避免的那种谎。
  if (!accepted) return { ok: false, reason: "duplicate", toAgentId };

  await project.recordMention({
    fromId: input.fromId,
    toAgentId,
    path: input.path
  });

  return { ok: true, toAgentId, depth: input.depth };
}
