import { agentKey, scoped } from "./agent-key";

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

/**
 * 深度写进消息本身，不存 DO。
 *
 * 存过：一个 `agentshow:mentionDepth` 键，投递时写、beforeTurn 时读、轮末删。
 * 那是错的 —— 两条提及排队到同一个 agent 时，后到的把先到的深度覆盖掉，
 * 而先跑完的那一轮又会把还没轮到的那条的深度删掉。环的防护于是双向失效：
 * 既误拦合法的第 2 跳，也放行本该拦住的第 4 跳。
 *
 * Think 的文档写明「submission 的消息只在它自己那一轮开始执行时才进 Session」，
 * 所以 beforeTurn 看到的最后一条用户消息就是这一轮那条提及。
 * 让每条消息自己带着深度，就没有任何跨轮共享的状态可以被覆盖。
 *
 * 这句话对模型也是有用的信息（「你已经在链子深处了」），所以它是正文的一部分，
 * 不是藏起来的标记。人在对话框里手打它最多把自己的深度抬高、更早被拦。
 */
export function depthLine(depth: number): string {
  return `（这是提及链的第 ${depth} 跳，最多 ${MAX_MENTION_DEPTH} 跳）`;
}

const DEPTH_RE = /（这是提及链的第 (\d+) 跳，最多 \d+ 跳）/g;

/**
 * 把提及正文里的深度标记抹掉。
 *
 * 正文是**发起方 agent 完全控制**的（`mentionAgent` 的 message 参数）。
 * 不抹的话，一个复述了自己收到的通知的 agent 会把旧的低深度一起带过去，
 * 而拼接时真实深度追加在末尾 —— 于是每一跳都读到 0，A↔B 的环永远拦不住。
 * 实测：正文含「第 0 跳」、末尾追加「第 3 跳」，读出来是 0。
 */
export function stripDepthMarks(text: string): string {
  return text.replace(DEPTH_RE, "（深度标记已移除）");
}

/**
 * 从一段消息正文里读回深度。人类发起的轮次没有这行标记，返回 0。
 *
 * 出现多个标记时**向上取**而不是取第一个：这是不该发生的情况，
 * 而在一个防死循环的闸上，猜错的代价不对称 —— 少算一跳会让环继续烧钱，
 * 多算一跳只是让一次合法提及被拦下并报错。
 */
export function depthInText(text: string): number {
  const found = [...text.matchAll(DEPTH_RE)]
    .map((m) => Number(m[1]))
    .filter((n) => Number.isFinite(n) && n >= 0);

  if (found.length === 0) return 0;
  return Math.max(...found);
}

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
  /** 当前这一轮所处的提及深度。人类发起的轮次是 0。 */
  depth: number;
  /**
   * 这次提及动作自己的 id，用来做重投幂等。
   *
   * 不给就现生成一个，也就是「每次调用都是一次新的提及」。
   * 网络重试要复用同一条动作时才需要显式传。
   */
  mentionId?: string;
};

export type MentionResult =
  | { ok: true; toAgentId: string }
  | { ok: false; reason: "max_depth" }
  | { ok: false; reason: "unknown_agent" }
  /** 同一条提及被重投，目标没有新一轮。调用方不该据此宣称叫醒了谁。 */
  | { ok: false; reason: "duplicate"; toAgentId: string };

export async function deliverMention(
  env: Env,
  input: MentionInput
): Promise<MentionResult> {
  if (input.depth > MAX_MENTION_DEPTH) {
    return { ok: false, reason: "max_depth" };
  }

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

  return { ok: true, toAgentId };
}
