/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { handleApi } from "../../src/api";
import type {
  AgentCardView,
  FileDetailView,
  MeView,
  ProjectView
} from "../../src/api-types";

/**
 * 界面用的 HTTP 面。email 是 verifyAccess 验过之后传进来的，
 * 不是请求里的字段 —— 这些测试里直接给，等价于「已经登录成这个人」。
 */

const ME = "demo@agentshow.io";
const OTHER = "someone@youware.com";

const get = (path: string, as = ME) =>
  handleApi(new Request(`https://agentshow.io${path}`), env, as);

const post = (path: string, body: unknown, as = ME) =>
  handleApi(
    new Request(`https://agentshow.io${path}`, {
      method: "POST",
      body: JSON.stringify(body)
    }),
    env,
    as
  );

describe("handleApi", () => {
  it("不是 /api/ 开头就不接，交给后面的路由", async () => {
    expect(await get("/")).toBeNull();
    expect(await get("/agents/AgentDO/ferrule:pricing")).toBeNull();
  });

  it("造 agent 之后出现在 /api/me，带身份卡里的简介和头像", async () => {
    const created = await post("/api/agents", {
      agentId: "ferrule",
      name: "Ferrule",
      tagline: "写实现，产出交给别人复审",
      avatar: "/avatars/ferrule.png",
      soul: "你只写实现。"
    });
    expect(created?.status).toBe(201);

    const me = (await (await get("/api/me"))!.json()) as MeView;
    expect(me.name).toBe("demo");
    expect(me.agents).toHaveLength(1);
    expect(me.agents[0]).toMatchObject({
      memberId: "ferrule",
      kind: "agent",
      name: "Ferrule",
      tagline: "写实现，产出交给别人复审",
      avatar: "/avatars/ferrule.png"
    });
  });

  it("建 project 之后建的人立刻是成员", async () => {
    expect(
      (await post("/api/projects", { projectId: "pricing", name: "定价页改版" }))
        ?.status
    ).toBe(201);

    const p = (await (await get("/api/projects/pricing"))!.json()) as ProjectView;
    expect(p.name).toBe("定价页改版");
    expect(p.members).toEqual([
      { memberId: ME, kind: "human", name: "demo" }
    ]);
  });

  // 这条是这组里最重要的：projectId 是可猜的 slug。
  it("读不到别人工作台里的 project", async () => {
    const res = await get("/api/projects/pricing", OTHER);
    expect(res?.status).toBe(404);
  });

  it("拉 agent 进 project，成员表里带上身份卡，并记一条 joined", async () => {
    expect(
      (await post("/api/projects/pricing/members", { agentId: "ferrule" }))?.status
    ).toBe(201);

    const p = (await (await get("/api/projects/pricing"))!.json()) as ProjectView;
    expect(p.members.map((m) => m.memberId)).toEqual([ME, "ferrule"]);
    expect(p.members[1].tagline).toBe("写实现，产出交给别人复审");

    expect(p.activity[0]).toMatchObject({
      actorId: ME,
      actorKind: "human",
      verb: "joined",
      targetId: "ferrule"
    });
  });

  it("拉不进不属于自己的 agent —— 否则 @提及会去唤醒一个不存在的 agent", async () => {
    const res = await post("/api/projects/pricing/members", { agentId: "ghost" });
    expect(res?.status).toBe(400);
  });

  it("带冒号的 id 被挡掉 —— 它会把 session 实例名切错", async () => {
    const res = await post("/api/agents", { agentId: "a:b", name: "X" });
    expect(res?.status).toBe(400);
  });

  it("文件列表把评论数并进去，一次查完", async () => {
    const project = env.ProjectDO.get(env.ProjectDO.idFromName("pricing"));
    project.writeFile({
      path: "pricing-table.tsx",
      content: "v1",
      baseVersion: 0,
      authorId: "ferrule"
    });
    project.addComment({
      path: "pricing-table.tsx",
      authorId: ME,
      text: "第 42 行的空数组会让表头塌掉"
    });

    const p = (await (await get("/api/projects/pricing"))!.json()) as ProjectView;
    expect(p.files).toEqual([
      {
        path: "pricing-table.tsx",
        version: 1,
        ownerId: "ferrule",
        updatedAt: expect.any(Number),
        comments: 1
      }
    ]);
  });
});

describe("文件详情", () => {
  it("内容、版本、归属和讨论一次给全", async () => {
    const res = await get("/api/projects/pricing/file?path=pricing-table.tsx");
    const d = (await res!.json()) as FileDetailView;

    expect(d).toMatchObject({
      path: "pricing-table.tsx",
      content: "v1",
      version: 1,
      // 归属在 listFiles 里，内容在 readFile 里 —— 少并一处就是界面上一行空白。
      ownerId: "ferrule"
    });
    expect(d.comments).toHaveLength(1);
    expect(d.comments[0].text).toContain("第 42 行");
  });

  it("不存在的文件 404，不是一个内容为空的详情页", async () => {
    const res = await get("/api/projects/pricing/file?path=nope.md");
    expect(res?.status).toBe(404);
  });

  it("不给 path 是 400", async () => {
    expect((await get("/api/projects/pricing/file"))?.status).toBe(400);
  });

  it("人留的评论作者是他自己，记进活动流", async () => {
    const res = await post("/api/projects/pricing/comments", {
      path: "pricing-table.tsx",
      text: "这一版可以，先合了",
      anchor: "整体"
    });
    expect(res?.status).toBe(201);

    const p = (await (await get("/api/projects/pricing"))!.json()) as ProjectView;
    expect(p.activity[0]).toMatchObject({
      actorId: ME,
      actorKind: "human",
      verb: "commented"
    });
  });
});

describe("人发起的 @提及", () => {
  // 人在文件上 @ 一个 agent 把活接过去，是这个产品的主要入口之一。
  it("投递成功，活动流里主语是人", async () => {
    const res = await post("/api/projects/pricing/mentions", {
      toAgentName: "Ferrule",
      path: "pricing-table.tsx",
      message: "把第 42 行的空数组处理掉"
    });
    expect(res?.status).toBe(201);
    expect(await res!.json()).toEqual({ ok: true, toAgentId: "ferrule" });

    const p = (await (await get("/api/projects/pricing"))!.json()) as ProjectView;
    expect(p.activity[0]).toMatchObject({
      actorId: ME,
      actorKind: "human",
      verb: "mentioned",
      detail: "ferrule"
    });
  });

  it("@ 不存在的名字返回 400，不静默丢弃", async () => {
    const res = await post("/api/projects/pricing/mentions", {
      toAgentName: "根本没这个人",
      path: "pricing-table.tsx",
      message: "在吗"
    });
    expect(res?.status).toBe(400);
    expect(await res!.json()).toEqual({ ok: false, reason: "unknown_agent" });
  });
});

describe("身份卡", () => {
  it("带身份文档，并且只列出它真的在的那些 project", async () => {
    // 第二个 project，Ferrule 不在里面。没有它，「列出所在 project」
    // 和「列出我的全部 project」两种实现给出的答案完全一样。
    await post("/api/projects", { projectId: "sea-saas", name: "SEA SaaS 调研" });

    const card = (await (await get("/api/agents/ferrule"))!.json()) as AgentCardView;

    expect(card).toMatchObject({
      agentId: "ferrule",
      name: "Ferrule",
      tagline: "写实现，产出交给别人复审",
      identityDoc: "你只写实现。"
    });
    expect(card.projects.map((p) => p.projectId)).toEqual(["pricing"]);
  });

  it("查不到别人工作台里的 agent", async () => {
    expect((await get("/api/agents/ferrule", OTHER))?.status).toBe(404);
  });
});
