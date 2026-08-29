/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

/**
 * 乐观并发是整个系统里唯一会真正出错的地方。
 *
 * 这里断言的不是「写入成功」，而是**写入被拒时拿回了什么** ——
 * agent 必须能直接在返回的新内容上重做，而不是收到一句错误就放弃。
 * 拒绝的返回值比拒绝本身更重要。
 */

const stub = () => env.ProjectDO.get(env.ProjectDO.idFromName("p-test"));

describe("ProjectDO 文件与版本", () => {
  it("首次写入 baseVersion 为 0，版本从 1 开始", async () => {
    await runInDurableObject(stub(), async (p) => {
      const r = await p.writeFile({
        path: "a.md",
        content: "v1",
        baseVersion: 0,
        authorId: "ferrule"
      });
      expect(r).toEqual({ ok: true, version: 1 });
    });
  });

  it("baseVersion 落后的写入被拒绝，并拿回当前内容和版本", async () => {
    await runInDurableObject(stub(), async (p) => {
      const ok = await p.writeFile({
        path: "b.md",
        content: "第一版",
        baseVersion: 0,
        authorId: "ferrule"
      });
      expect(ok).toEqual({ ok: true, version: 1 });

      const ok2 = await p.writeFile({
        path: "b.md",
        content: "第二版",
        baseVersion: 1,
        authorId: "ferrule"
      });
      expect(ok2).toEqual({ ok: true, version: 2 });

      // Verdigris 手上还是 v1 时代的快照
      const stale = await p.writeFile({
        path: "b.md",
        content: "基于旧内容的改动",
        baseVersion: 1,
        authorId: "verdigris"
      });

      // 关键：不是一句错误，而是带着当前内容和版本回来
      expect(stale).toEqual({
        ok: false,
        reason: "stale",
        version: 2,
        content: "第二版"
      });
    });
  });

  it("被拒绝的写入不污染文件", async () => {
    await runInDurableObject(stub(), async (p) => {
      const f = await p.readFile("b.md");
      expect(f).toEqual({ content: "第二版", version: 2 });
    });
  });

  it("owner 是创建者，别人改它不夺走归属", async () => {
    await runInDurableObject(stub(), async (p) => {
      await p.writeFile({ path: "c.md", content: "x", baseVersion: 0, authorId: "sable" });
      await p.writeFile({ path: "c.md", content: "y", baseVersion: 1, authorId: "ferrule" });

      const list = await p.listFiles();
      const c = list.find((f) => f.path === "c.md");
      expect(c?.ownerId).toBe("sable");
      expect(c?.version).toBe(2);
    });
  });

  it("读不存在的文件返回 null，不抛异常", async () => {
    await runInDurableObject(stub(), async (p) => {
      expect(await p.readFile("从来没有过.md")).toBeNull();
    });
  });
});
