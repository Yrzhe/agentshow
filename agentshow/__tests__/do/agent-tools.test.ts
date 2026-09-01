/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { projectTools } from "../../src/agent-tools";

/**
 * 工具接的是**真的 ProjectDO stub**（跨 DO 的 RPC 调用），不是 mock。
 * mock 掉 stub 就等于没测到「RPC 调用的返回值形状对不对」，
 * 而那正是这一层唯一会出错的地方。
 */

function toolsFor(agentName: string, canWrite = true) {
  const stub = env.ProjectDO.get(env.ProjectDO.idFromName("p-tools"));
  return projectTools({
    project: stub,
    authorId: agentName,
    canWrite,
    // 这组测试只验 project 文件工具，提及走 mention.test.ts。
    mention: async () => ({ ok: true })
  });
}

async function run<T = unknown>(tool: { execute?: unknown }, input: unknown): Promise<T> {
  // AI SDK 的 tool() 把实现放在 execute 上；测试直接调它，绕过模型。
  const exec = tool.execute as (i: unknown, o: unknown) => Promise<T>;
  return exec(input, {});
}

describe("project 工具接真 ProjectDO", () => {
  it("writeProjectFile 首次写入成功", async () => {
    const t = toolsFor("ferrule");
    const r = await run(t.writeProjectFile, {
      path: "spec.md",
      content: "第一版",
      baseVersion: 0
    });
    expect(r).toEqual({ ok: true, version: 1 });
  });

  it("readProjectFile 读回内容和版本", async () => {
    const t = toolsFor("ferrule");
    const r = await run(t.readProjectFile, { path: "spec.md" });
    expect(r).toEqual({ content: "第一版", version: 1 });
  });

  it("过期写入被拒，且返回里带着当前内容 —— agent 据此重做", async () => {
    const t = toolsFor("verdigris");
    await run(t.writeProjectFile, { path: "spec.md", content: "第二版", baseVersion: 1 });

    const stale = await run<{ ok: boolean; content?: string; version?: number }>(
      t.writeProjectFile,
      { path: "spec.md", content: "基于旧内容", baseVersion: 1 }
    );
    expect(stale.ok).toBe(false);
    expect(stale.version).toBe(2);
    expect(stale.content).toBe("第二版");
  });

  it("authorId 取自 agent 名字，owner 落在首个写入者身上", async () => {
    const t = toolsFor("sable");
    await run(t.writeProjectFile, { path: "notes.md", content: "x", baseVersion: 0 });

    const list = await run<Array<{ path: string; ownerId: string }>>(
      toolsFor("ferrule").listProjectFiles,
      {}
    );
    expect(list.find((f) => f.path === "notes.md")?.ownerId).toBe("sable");
  });

  it("commentOnProjectFile 把评论挂到文件上", async () => {
    const t = toolsFor("verdigris");
    await run(t.commentOnProjectFile, {
      path: "spec.md",
      text: "第 42 行的空数组会让表头塌掉",
      anchor: "第 42 行"
    });

    const stub = env.ProjectDO.get(env.ProjectDO.idFromName("p-tools"));
    const cs = await stub.listComments("spec.md");
    expect(cs.at(-1)?.text).toContain("空数组");
    expect(cs.at(-1)?.anchor).toBe("第 42 行");
    expect(cs.at(-1)?.authorId).toBe("verdigris");
  });

  it("评论工具的说明在逼模型给具体的，不给套话", () => {
    const t = toolsFor("verdigris");
    const desc = (t.commentOnProjectFile as { description?: string }).description ?? "";
    // 复审 agent 留一句「建议优化一下」的话，形态再对演示也白搭。
    expect(desc).toMatch(/具体/);
    expect(desc).toMatch(/建议优化一下|没有信息量/);
  });

  it("writeProjectFile 的说明必须教会模型 stale 之后要重做", () => {
    const t = toolsFor("ferrule");
    const desc = (t.writeProjectFile as { description?: string }).description ?? "";
    // 这不是文风检查。乐观并发成不成立，取决于模型看到 stale 之后
    // 是重做还是报错放弃，而它唯一的依据就是这段说明。
    expect(desc).toContain("stale");
    expect(desc).toMatch(/重做|retry|重试/);
  });

  describe("只读的 agent", () => {
    // 「我从不改代码」写在 soul 里只是一句承诺 —— 模型偏离一次、
    // 或者用户说一句「顺手修一下」，它照样能整份覆盖文件。
    // 而界面把它展示成一个独立的只读复审者。
    it("根本拿不到写工具", () => {
      expect(toolsFor("verdigris", false).writeProjectFile).toBeUndefined();
    });

    it("读、评论、@提及照旧 —— 那正是复审者的产出", () => {
      const t = toolsFor("verdigris", false);
      expect(t.readProjectFile).toBeDefined();
      expect(t.listProjectFiles).toBeDefined();
      expect(t.commentOnProjectFile).toBeDefined();
      expect(t.mentionAgent).toBeDefined();
    });
  });
});
