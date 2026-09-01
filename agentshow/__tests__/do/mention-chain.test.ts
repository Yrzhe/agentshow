/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { deliverMention, MAX_MENTION_DEPTH } from "../../src/mention";
import { scoped } from "../../src/agent-key";

/**
 * 提及链的核心不变量：环一定会停，而且并发不会让账算少。
 *
 * 深度绑在**正在执行的那条 submission** 的 metadata 上，由服务端写入
 * （AgentDO.#currentDepth）—— 链条上任何一方都改不动。下面几条就是那个断言。
 */

const OWNER = "c@x.com";
const P = "p-conc";
const base = { owner: OWNER, projectId: P, path: "x.md", message: "m" };

describe("并发与环", () => {
  it("seed", async () => {
    const p = env.ProjectDO.get(env.ProjectDO.idFromName(scoped(OWNER, P)));
    await runInDurableObject(p, async (o) => {
      o.addMember({ memberId: "a", kind: "agent", name: "A" });
      o.addMember({ memberId: "b", kind: "agent", name: "B" });
      o.addMember({ memberId: "h@x.com", kind: "human", name: "H" });
    });
    expect(true).toBe(true);
  });

  // 深度由服务端从「正在跑的那条 submission」取（AgentDO.#currentDepth），
  // 这里直接给，等价于每一跳都由上一跳的 metadata 传下来。
  it("A↔B 的环会在第 4 次投递被拦，且每一跳的返回形状完整", async () => {
    const hop = (from: string, to: string, depth: number) =>
      deliverMention(env, { ...base, fromId: from, toAgentName: to, depth });

    expect(await hop("h@x.com", "A", 0)).toEqual({
      ok: true, toAgentId: "a", depth: 0
    });
    expect(await hop("a", "B", 1)).toEqual({ ok: true, toAgentId: "b", depth: 1 });
    expect(await hop("b", "A", 2)).toEqual({ ok: true, toAgentId: "a", depth: 2 });
    // 上限是包含的：正好等于 MAX 仍放行。
    expect(await hop("a", "B", MAX_MENTION_DEPTH)).toEqual({
      ok: true, toAgentId: "b", depth: MAX_MENTION_DEPTH
    });
    // 超过才拦。
    expect(await hop("b", "A", MAX_MENTION_DEPTH + 1)).toEqual({
      ok: false, reason: "max_depth"
    });
  });

  it("两条并发投给同一目标，各自带各自的深度，互不影响", async () => {
    const p2 = "p-conc2";
    const pd = env.ProjectDO.get(env.ProjectDO.idFromName(scoped(OWNER, p2)));
    await runInDurableObject(pd, async (o) => {
      o.addMember({ memberId: "a", kind: "agent", name: "A" });
      o.addMember({ memberId: "b", kind: "agent", name: "B" });
      o.addMember({ memberId: "c", kind: "agent", name: "C" });
    });

    // 深度跟着各自的 submission 走，所以一条第 1 跳、一条第 3 跳同时投给 B，
    // 两条互不干扰 —— 这正是时间窗账本做不到的那件事。
    const [x, y] = await Promise.all([
      deliverMention(env, {
        ...base, projectId: p2, fromId: "a", toAgentName: "B", depth: 1
      }),
      deliverMention(env, {
        ...base, projectId: p2, fromId: "c", toAgentName: "B", depth: MAX_MENTION_DEPTH
      })
    ]);
    expect(x).toEqual({ ok: true, toAgentId: "b", depth: 1 });
    expect(y).toEqual({ ok: true, toAgentId: "b", depth: MAX_MENTION_DEPTH });
  });
});

describe("被拦下的那一跳要留在活动流里", () => {
  it("超过上限时记一条 blocked，而不是无声地返回", async () => {
    const p = env.ProjectDO.get(env.ProjectDO.idFromName(scoped(OWNER, P)));
    const before = await runInDurableObject(p, async (o) =>
      o.listActivity(200).filter((r) => r.verb === "blocked").length
    );

    const r = await deliverMention(env, {
      ...base,
      fromId: "a",
      toAgentName: "B",
      depth: MAX_MENTION_DEPTH + 1
    });
    expect(r).toEqual({ ok: false, reason: "max_depth" });

    await runInDurableObject(p, async (o) => {
      const blocked = o.listActivity(200).filter((r) => r.verb === "blocked");
      expect(blocked).toHaveLength(before + 1);
      expect(blocked[0].actorId).toBe("a");
      expect(blocked[0].detail).toBe("B");
    });
  });

  // 拦下来这件事记了，但不能顺手记成一条「A 提及了 B」——
  // 那样活动流会显示提及成功，而目标从没醒过。
  it("记 blocked 不记 mentioned", async () => {
    const p = env.ProjectDO.get(env.ProjectDO.idFromName(scoped(OWNER, P)));
    const before = await runInDurableObject(p, async (o) =>
      o.listActivity(200).filter((r) => r.verb === "mentioned").length
    );

    await deliverMention(env, {
      ...base,
      fromId: "a",
      toAgentName: "B",
      depth: MAX_MENTION_DEPTH + 1
    });

    await runInDurableObject(p, async (o) => {
      const after = o.listActivity(200).filter((r) => r.verb === "mentioned");
      expect(after).toHaveLength(before);
    });
  });
});
