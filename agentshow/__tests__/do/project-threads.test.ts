/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

/**
 * 讨论挂在文件上，不挂在对话上。
 *
 * 这是"不做群聊"那个决定的另一半：协作的单位必须是能被完成、能被评审、
 * 能被回滚的东西。聊天没有完成态，文件有。
 */

const p = () => env.ProjectDO.get(env.ProjectDO.idFromName("p-threads"));

describe("ProjectDO 讨论线程", () => {
  it("评论挂在路径上，按时间正序返回", async () => {
    await runInDurableObject(p(), async (o) => {
      o.writeFile({ path: "a.tsx", content: "v1", baseVersion: 0, authorId: "ferrule" });
      o.addComment({ path: "a.tsx", authorId: "verdigris", text: "第一条" });
      o.addComment({ path: "a.tsx", authorId: "verdigris", text: "第二条" });

      const cs = o.listComments("a.tsx");
      expect(cs.map((c) => c.text)).toEqual(["第一条", "第二条"]);
    });
  });

  it("评论记下它针对的是文件哪个版本", async () => {
    await runInDurableObject(p(), async (o) => {
      // a.tsx 现在是 v1
      const cs = o.listComments("a.tsx");
      expect(cs.every((c) => c.fileVersion === 1)).toBe(true);

      o.writeFile({ path: "a.tsx", content: "v2", baseVersion: 1, authorId: "ferrule" });
      o.addComment({ path: "a.tsx", authorId: "verdigris", text: "针对新版本" });

      const after = o.listComments("a.tsx");
      expect(after.at(-1)?.fileVersion).toBe(2);
      // 老评论的版本号不会被改写 —— 它说的确实是当时那一版
      expect(after[0].fileVersion).toBe(1);
    });
  });

  it("anchor 可选，用来标「第 42 行」这类定位", async () => {
    await runInDurableObject(p(), async (o) => {
      o.addComment({
        path: "a.tsx",
        authorId: "verdigris",
        text: "空数组会让表头塌掉",
        anchor: "第 42 行"
      });
      expect(o.listComments("a.tsx").at(-1)?.anchor).toBe("第 42 行");
    });
  });

  it("不同文件的评论互不串", async () => {
    await runInDurableObject(p(), async (o) => {
      o.addComment({ path: "b.md", authorId: "sable", text: "另一个文件" });
      expect(o.listComments("a.tsx").some((c) => c.text === "另一个文件")).toBe(false);
      expect(o.listComments("b.md")).toHaveLength(1);
    });
  });

  it("commentCounts 一次查完所有文件的评论数", async () => {
    await runInDurableObject(p(), async (o) => {
      const counts = o.commentCounts();
      expect(counts["a.tsx"]).toBe(4);
      expect(counts["b.md"]).toBe(1);
      // 没有评论的文件不出现在结果里，前端按缺失当 0 处理
      expect(counts["从来没有过.md"]).toBeUndefined();
    });
  });

  it("可以给还不存在的文件留评论 —— fileVersion 记 0", async () => {
    await runInDurableObject(p(), async (o) => {
      o.addComment({ path: "还没建.md", authorId: "yrzhe", text: "先提个要求" });
      expect(o.listComments("还没建.md").at(-1)?.fileVersion).toBe(0);
    });
  });
});
