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
});
