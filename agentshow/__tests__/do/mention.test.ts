/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { MAX_MENTION_DEPTH, deliverMention } from "../../src/mention";

/**
 * @提及 是跨 agent 的唯一通道。
 *
 * 不做群聊换来的是：不要求目标 agent 在线。投递走 submitMessages —— 持久化接收，
 * DO 睡着也不丢，醒来处理。代价是必须自己防环：A @ B、B @ A 是个会一直烧钱的
 * 循环，而且在演示里撞上的概率不低。
 */

const PROJECT = "p-mention";

async function seedMembers() {
  const p = env.ProjectDO.get(env.ProjectDO.idFromName(PROJECT));
  await runInDurableObject(p, async (o) => {
    o.addMember({ memberId: "ferrule", kind: "agent", name: "Ferrule" });
    o.addMember({ memberId: "verdigris", kind: "agent", name: "Verdigris" });
    o.addMember({ memberId: "love@yrzhe.space", kind: "human", name: "yrzhe" });
  });
}

const base = {
  projectId: PROJECT,
  fromAgentId: "ferrule",
  path: "spec.md",
  message: "帮我复审一下第 42 行",
  depth: 1
};

describe("@提及", () => {
  it("按名字解析到 agent 并投递成功", async () => {
    await seedMembers();
    const r = await deliverMention(env, { ...base, toAgentName: "Verdigris" });
    expect(r).toEqual({ ok: true, toAgentId: "verdigris" });
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

  it("超过深度上限被拦下 —— 防 A @ B、B @ A 的死循环", async () => {
    const r = await deliverMention(env, {
      ...base,
      toAgentName: "Verdigris",
      depth: MAX_MENTION_DEPTH + 1
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("max_depth");
  });

  it("正好等于上限时仍然放行，上限是包含的", async () => {
    const r = await deliverMention(env, {
      ...base,
      toAgentName: "Verdigris",
      depth: MAX_MENTION_DEPTH
    });
    expect(r.ok).toBe(true);
  });

  it("投递会把深度存进目标 agent，供它自己再 @ 别人时递增", async () => {
    await deliverMention(env, { ...base, toAgentName: "Verdigris", depth: 2 });
    const target = env.AgentDO.get(env.AgentDO.idFromName(`verdigris:${PROJECT}`));
    await runInDurableObject(target, async (a) => {
      expect(await a.currentMentionDepth()).toBe(2);
    });
  });

  it("没被提及过的 agent 深度是 0", async () => {
    const fresh = env.AgentDO.get(env.AgentDO.idFromName(`sable:${PROJECT}`));
    await runInDurableObject(fresh, async (a) => {
      expect(await a.currentMentionDepth()).toBe(0);
    });
  });
});
