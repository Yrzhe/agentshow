/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { projectTools } from "../../src/agent-tools";

/**
 * 工具接的是**真的 ProjectDO stub**（跨 DO 的 RPC 调用），不是 mock。
 * mock 掉 stub 就等于没测到「RPC 调用的返回值形状对不对」，
 * 而那正是这一层唯一会出错的地方。
 */

function toolsFor(agentName: string) {
  const stub = env.ProjectDO.get(env.ProjectDO.idFromName("p-tools"));
  return projectTools(stub, agentName);
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

  it("writeProjectFile 的说明必须教会模型 stale 之后要重做", () => {
    const t = toolsFor("ferrule");
    const desc = (t.writeProjectFile as { description?: string }).description ?? "";
    // 这不是文风检查。乐观并发成不成立，取决于模型看到 stale 之后
    // 是重做还是报错放弃，而它唯一的依据就是这段说明。
    expect(desc).toContain("stale");
    expect(desc).toMatch(/重做|retry|重试/);
  });
});
