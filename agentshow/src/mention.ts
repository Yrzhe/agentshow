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

/**
 * 往前追溯多久算同一条链。
 *
 * 一个小时前被 @ 过，不该让现在这次正常对话背上深度。而一个真的环会在
 * 几分钟里烧完全部跳数，所以窗口取得比它宽、比「另一次独立对话」窄。
 */
const CHAIN_WINDOW_MS = 15 * 60_000;

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
 * 深度由服务端从提及链算出来，**不由调用方声称、也不从消息正文里读**。
 *
 * 早先两版都栽在这上面：第一版把深度存在 AgentDO 的一个键里，排队的两条提及
 * 互相覆盖；第二版把它写进消息正文，结果 agent 复述一遍通知就把旧深度带过去，
 * 人在聊天框打出那句话还能伪造。正文和跨轮的单值键都是**别人能写的地方**。
 *
 * 现在：每投递成功一条就在 ProjectDO 记一跳；下一跳的深度 = 「谁最近叫醒过我」
 * 那一行的深度 + 1，查不到就是 0。这是服务端自己的账，链条上任何一方都改不动。
 */
export async function deliverMention(
  env: Env,
  input: MentionInput
): Promise<MentionResult> {
  const project = env.ProjectDO.get(
    env.ProjectDO.idFromName(scoped(input.owner, input.projectId))
  );

  const prior = await project.lastMentionDepth(input.fromId, CHAIN_WINDOW_MS);
  const depth = prior === null ? 0 : prior + 1;
  if (depth > MAX_MENTION_DEPTH) return { ok: false, reason: "max_depth" };

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
    depth,
    mentionId: input.mentionId ?? crypto.randomUUID()
  });

  // 没被接受就是重投，目标没有新一轮 —— 这时候记活动会让界面上出现
  // 一条「A 提及了 B」而 B 从没醒过，正是这套东西最该避免的那种谎。
  // 跳数也不记：那一跳早就记过了，再记一次会把链条算长。
  if (!accepted) return { ok: false, reason: "duplicate", toAgentId };

  await Promise.all([
    project.recordMentionHop({ toAgentId, depth }),
    project.recordMention({ fromId: input.fromId, toAgentId, path: input.path })
  ]);

  return { ok: true, toAgentId, depth };
}
