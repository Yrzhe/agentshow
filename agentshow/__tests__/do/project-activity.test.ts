/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

/**
 * 活动流的主语必须能是 agent。
 *
 * actorKind 写进 schema 而不是让前端去推断 —— 前端一旦要靠"这个 id 看起来像
 * 邮箱所以是人"来猜，第一个用 agent 名当邮箱的人就会把它猜错。
 */

const p = () => env.ProjectDO.get(env.ProjectDO.idFromName("p-activity"));

describe("ProjectDO 活动流", () => {
  it("首次写入记 created，后续写入记 updated", async () => {
    await runInDurableObject(p(), async (o) => {
      o.addMember({ memberId: "ferrule", kind: "agent", name: "Ferrule" });
      o.writeFile({ path: "a.md", content: "v1", baseVersion: 0, authorId: "ferrule" });
      o.writeFile({ path: "a.md", content: "v2", baseVersion: 1, authorId: "ferrule" });

      const acts = o.listActivity(10);
      expect(acts.map((a) => a.verb)).toEqual(["updated", "created"]);
      // 倒序：最新的在前
      expect(acts[0].targetId).toBe("a.md");
    });
  });

  it("主语带 actorKind，且能是 agent", async () => {
    await runInDurableObject(p(), async (o) => {
      const acts = o.listActivity(10);
      expect(acts[0].actorId).toBe("ferrule");
      expect(acts[0].actorKind).toBe("agent");
    });
  });

  it("不在成员表里的作者记 agent —— 只有人类需要显式登记", async () => {
    await runInDurableObject(p(), async (o) => {
      o.addMember({ memberId: "love@yrzhe.space", kind: "human", name: "yrzhe" });
      o.writeFile({
        path: "b.md",
        content: "x",
        baseVersion: 0,
        authorId: "love@yrzhe.space"
      });
      expect(o.listActivity(1)[0].actorKind).toBe("human");
    });
  });

  // 这条是整个活动流里最有价值的一条。
  it("写入被拒也记一条 —— 没有它，乐观并发的故事在界面上就消失了", async () => {
    await runInDurableObject(p(), async (o) => {
      o.writeFile({
        path: "a.md",
        content: "基于旧内容",
        baseVersion: 1, // 当前已经是 2
        authorId: "verdigris"
      });
      const top = o.listActivity(1)[0];
      expect(top.verb).toBe("rejected");
      expect(top.actorId).toBe("verdigris");
      expect(top.targetId).toBe("a.md");
    });
  });

  it("评论记 commented，目标是文件", async () => {
    await runInDurableObject(p(), async (o) => {
      o.addComment({ path: "a.md", authorId: "verdigris", text: "空数组会塌" });
      const top = o.listActivity(1)[0];
      expect(top.verb).toBe("commented");
      expect(top.targetType).toBe("file");
    });
  });

  it("提及记 mentioned", async () => {
    await runInDurableObject(p(), async (o) => {
      o.recordMention({ fromId: "ferrule", toAgentId: "verdigris", path: "a.md" });
      const top = o.listActivity(1)[0];
      expect(top.verb).toBe("mentioned");
      expect(top.actorId).toBe("ferrule");
      expect(top.targetId).toBe("a.md");
    });
  });

  it("limit 生效，且永远是倒序", async () => {
    await runInDurableObject(p(), async (o) => {
      const three = o.listActivity(3);
      expect(three).toHaveLength(3);
      const all = o.listActivity(100);
      expect(all[0].at).toBeGreaterThanOrEqual(all[all.length - 1].at);
    });
  });

  // 界面拿它决定「更早的」出不出现。答错就是要么骗人说没有了、
  // 要么给一个点了什么都不来的按钮。
  it("hasActivityBefore 认得出还有没有更早的", async () => {
    await runInDurableObject(p(), async (o) => {
      const all = o.listActivity(1000);
      const oldest = all[all.length - 1];
      expect(o.hasActivityBefore(oldest.id)).toBe(false);
      expect(o.hasActivityBefore(all[0].id)).toBe(true);
    });
  });

  it("窗口之外的行还在，只是要更大的 limit 才拿得到", async () => {
    await runInDurableObject(p(), async (o) => {
      const total = o.listActivity(1000).length;
      expect(total).toBeGreaterThan(2);
      expect(o.listActivity(2)).toHaveLength(2);
      expect(o.listActivity(total)).toHaveLength(total);
    });
  });

  describe("链条断掉时也要留下痕迹", () => {
    // 不记的话，时间线停在「A 提及了 B」，而「B 在处理」「B 失败了」
    // 「B 被深度闸拦了」这三种状态在界面上完全无法区分。
    it("提及被跳数上限拦下时记一条，主语是发起方", async () => {
      await runInDurableObject(p(), async (o) => {
        o.recordMentionBlocked({
          fromId: "sable",
          toAgentName: "Ferrule",
          path: "pricing.tsx"
        });
        const top = o.listActivity(1)[0];
        expect(top.verb).toBe("blocked");
        expect(top.actorId).toBe("sable");
        expect(top.targetId).toBe("pricing.tsx");
        // 记名字不记 id：链条断在这个名字面前时，它可能根本不是成员。
        expect(top.detail).toBe("Ferrule");
      });
    });

    it("推理失败记一条，主语是失败的那个 agent", async () => {
      await runInDurableObject(p(), async (o) => {
        o.recordTurnFailed({ agentId: "verdigris", detail: "ferrule 叫醒的那一轮" });
        const top = o.listActivity(1)[0];
        expect(top.verb).toBe("failed");
        expect(top.actorId).toBe("verdigris");
        expect(top.targetType).toBe("session");
      });
    });
  });
});
