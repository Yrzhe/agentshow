/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { agentKey, scoped } from "../../src/agent-key";
import { MAX_MENTION_DEPTH, deliverMention } from "../../src/mention";

/**
 * @提及 是跨 agent 的唯一通道。
 *
 * 不做群聊换来的是：不要求目标 agent 在线。投递走 submitMessages —— 持久化接收，
 * DO 睡着也不丢，醒来处理。代价是必须自己防环：A @ B、B @ A 是个会一直烧钱的
 * 循环，而且在演示里撞上的概率不低。
 */

const PROJECT = "p-mention";
const OWNER = "owner@yrzhe.space";

async function seedMembers() {
  const p = env.ProjectDO.get(env.ProjectDO.idFromName(scoped(OWNER, PROJECT)));
  await runInDurableObject(p, async (o) => {
    o.addMember({ memberId: "ferrule", kind: "agent", name: "Ferrule" });
    o.addMember({ memberId: "verdigris", kind: "agent", name: "Verdigris" });
    o.addMember({ memberId: "love@yrzhe.space", kind: "human", name: "yrzhe" });
  });
}

const base = {
  owner: OWNER,
  projectId: PROJECT,
  fromId: "ferrule",
  path: "spec.md",
  message: "帮我复审一下第 42 行"
};

describe("@提及", () => {
  it("按名字解析到 agent 并投递成功", async () => {
    await seedMembers();
    const r = await deliverMention(env, { ...base, toAgentName: "Verdigris" });
    expect(r).toMatchObject({ ok: true, toAgentId: "verdigris" });
  });

  it("解析不到的名字返回明确失败，不静默丢弃", async () => {
    // 静默丢弃在演示里表现为「agent 说我 @ 了它，然后什么都没发生」，
    // 是最难查的一类故障。
    const r = await deliverMention(env, { ...base, toAgentName: "根本没这个人" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unknown_agent");
  });

  it("人类不能被 @ 醒来干活", async () => {
    // 人没有 AgentDO，投递过去就是投进虚空。
    const r = await deliverMention(env, { ...base, toAgentName: "yrzhe" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unknown_agent");
  });

  // 深度由服务端从提及链算出来。之前两版分别栽在「存在跨轮的单值键」
  // 和「写进消息正文」上 —— 那两个地方都是别人能写的。
  const CHAIN = "p-chain";

  it("人发起的是第 0 跳，链条一跳一跳往上加", async () => {
    const p = env.ProjectDO.get(env.ProjectDO.idFromName(scoped(OWNER, CHAIN)));
    await runInDurableObject(p, async (o) => {
      o.addMember({ memberId: "human@x.com", kind: "human", name: "人" });
      o.addMember({ memberId: "ferrule", kind: "agent", name: "Ferrule" });
      o.addMember({ memberId: "verdigris", kind: "agent", name: "Verdigris" });
    });

    // 人 @ Verdigris —— 人从没被 @ 过，所以是第 0 跳
    const h = await deliverMention(env, {
      ...base,
      projectId: CHAIN,
      fromId: "human@x.com",
      toAgentName: "Verdigris"
    });
    expect(h).toMatchObject({ ok: true, depth: 0 });

    // Verdigris 现在被叫醒过（第 0 跳），它再 @ Ferrule 就是第 1 跳
    const v = await deliverMention(env, {
      ...base,
      projectId: CHAIN,
      fromId: "verdigris",
      toAgentName: "Ferrule"
    });
    expect(v).toMatchObject({ ok: true, depth: 1 });
  });

  it("超过上限被拦下 —— 防 A @ B、B @ A 的死循环", async () => {
    const p = env.ProjectDO.get(env.ProjectDO.idFromName(scoped(OWNER, CHAIN)));
    // 把链条推到上限：假装 ferrule 已经被叫醒到第 3 跳
    await runInDurableObject(p, async (o) => {
      o.recordMentionHop({ toAgentId: "ferrule", depth: MAX_MENTION_DEPTH });
    });

    const r = await deliverMention(env, {
      ...base,
      projectId: CHAIN,
      toAgentName: "Verdigris"
    });
    expect(r).toEqual({ ok: false, reason: "max_depth" });
  });

  it("窗口之外的旧记录不算 —— 一小时前被 @ 过不该压住现在的对话", async () => {
    const p = env.ProjectDO.get(env.ProjectDO.idFromName(scoped(OWNER, CHAIN)));
    await runInDurableObject(p, async (o) => {
      o.recordMentionHop({
        toAgentId: "sable",
        depth: MAX_MENTION_DEPTH,
        at: Date.now() - 60 * 60_000
      });
      // 一小时前那一跳，15 分钟的窗口看不见
      expect(o.lastMentionDepth("sable", 15 * 60_000)).toBeNull();
      // 放宽到两小时就看得见
      expect(o.lastMentionDepth("sable", 2 * 60 * 60_000)).toBe(MAX_MENTION_DEPTH);
    });
  });

  it("同一条提及重投返回 duplicate，不再谎报成功", async () => {
    const id = "mention-fixed-id";
    const first = await deliverMention(env, {
      ...base,
      toAgentName: "Verdigris",
      mentionId: id
    });
    expect(first).toMatchObject({ ok: true, toAgentId: "verdigris" });

    const again = await deliverMention(env, {
      ...base,
      toAgentName: "Verdigris",
      mentionId: id
    });
    expect(again).toEqual({
      ok: false,
      reason: "duplicate",
      toAgentId: "verdigris"
    });
  });

  it("内容相同但是新的一次提及，照常投递 —— 催办不该被吞掉", async () => {
    const r = await deliverMention(env, { ...base, toAgentName: "Verdigris" });
    expect(r.ok).toBe(true);
  });
});
