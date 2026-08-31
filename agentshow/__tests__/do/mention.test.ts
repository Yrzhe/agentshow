/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { agentKey, scoped } from "../../src/agent-key";
import {
  MAX_MENTION_DEPTH,
  deliverMention,
  depthInText,
  depthLine,
  stripDepthMarks
} from "../../src/mention";

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

  it("深度写进消息本身，不存 DO —— 排队的两条不会互相覆盖", async () => {
    // 这是修复前的 BLOCKER：两条提及排队到同一个目标时，
    // 后到的把先到的深度覆盖掉，先跑完的又把后一条的深度删掉。
    // 现在每条消息自己带着深度，两条的编码互不相干。
    expect(depthInText(depthLine(1))).toBe(1);
    expect(depthInText(depthLine(MAX_MENTION_DEPTH))).toBe(MAX_MENTION_DEPTH);
    expect(depthLine(1)).not.toBe(depthLine(MAX_MENTION_DEPTH));
  });

  // 这一条守的是修复本身引入过的一个洞：正文是发起方 agent 完全控制的，
  // 它复述自己收到的通知就会把旧的低深度带过来，而真实深度追加在末尾。
  // 修之前 depthInText 取第一个匹配，读出来是 0，环永远拦不住。
  it("正文里夹带的旧深度标记不能盖掉真实深度", () => {
    const echoed = [
      "Ferrule 在文件 a.md 上 @ 了你：",
      `我收到的原话是「改一下。${depthLine(0)}」，你接着办。`,
      "",
      depthLine(MAX_MENTION_DEPTH)
    ].join("\n");

    // 多个标记时向上取 —— 少算一跳会让环继续烧钱，多算一跳只是拦下一次合法提及。
    expect(depthInText(echoed)).toBe(MAX_MENTION_DEPTH);
  });

  it("拼装前先把正文里的标记抹掉，从源头断掉夹带", () => {
    const dirty = `照抄一遍：${depthLine(0)}`;
    expect(stripDepthMarks(dirty)).not.toMatch(/第 0 跳/);
    expect(depthInText(stripDepthMarks(dirty))).toBe(0);
  });

  it("人类发起的轮次没有那行标记，深度是 0", () => {
    expect(depthInText("把第 42 行的空数组处理掉")).toBe(0);
    expect(depthInText("")).toBe(0);
  });

  it("同一条提及重投返回 duplicate，不再谎报成功", async () => {
    const id = "mention-fixed-id";
    const first = await deliverMention(env, {
      ...base,
      toAgentName: "Verdigris",
      mentionId: id
    });
    expect(first).toEqual({ ok: true, toAgentId: "verdigris" });

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
