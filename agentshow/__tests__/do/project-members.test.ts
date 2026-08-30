/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

/**
 * members 一张表混装人和 agent，靠 kind 区分。
 *
 * 分成两张表等于在数据层宣告 agent 是二等公民 —— 后面 Overview 的成员区、
 * Activity 的主语、Files 的 owner 会被这个结构一路拖回"人在协作，agent 是工具"。
 * 这是整个设计的支点，不是实现细节，所以有一条测试专门盯着它。
 */

const p = () => env.ProjectDO.get(env.ProjectDO.idFromName("p-members"));

describe("ProjectDO 成员", () => {
  it("人和 agent 在同一张表里，用 kind 区分", async () => {
    await runInDurableObject(p(), async (o) => {
      o.addMember({ memberId: "love@yrzhe.space", kind: "human", name: "yrzhe" });
      o.addMember({ memberId: "ferrule", kind: "agent", name: "Ferrule" });
      o.addMember({ memberId: "verdigris", kind: "agent", name: "Verdigris" });

      const list = o.listMembers();
      expect(list).toHaveLength(3);
      expect(list.filter((m) => m.kind === "agent")).toHaveLength(2);
      expect(list.filter((m) => m.kind === "human")).toHaveLength(1);
    });
  });

  it("按名字解析 agent —— @提及要靠它", async () => {
    await runInDurableObject(p(), async (o) => {
      expect(o.resolveAgentByName("Verdigris")).toBe("verdigris");
    });
  });

  it("解析不到就返回 null，不抛异常", async () => {
    await runInDurableObject(p(), async (o) => {
      expect(o.resolveAgentByName("根本不存在")).toBeNull();
    });
  });

  it("人类不会被当成 agent 解析出来", async () => {
    await runInDurableObject(p(), async (o) => {
      expect(o.resolveAgentByName("yrzhe")).toBeNull();
    });
  });

  it("重复加同一个成员不会产生两行", async () => {
    await runInDurableObject(p(), async (o) => {
      o.addMember({ memberId: "ferrule", kind: "agent", name: "Ferrule" });
      expect(o.listMembers()).toHaveLength(3);
    });
  });
});

describe("ProjectDO session 索引", () => {
  it("只存指针不存内容，项目视角靠它回答「这个项目在干什么」", async () => {
    await runInDurableObject(p(), async (o) => {
      o.upsertSession({ agentId: "ferrule", title: "改写定价表组件" });
      o.upsertSession({ agentId: "verdigris", title: "复审 v3" });

      const s = o.listSessions();
      expect(s).toHaveLength(2);
      expect(s[0]).not.toHaveProperty("messages");
      expect(s.map((x) => x.status)).toEqual(["in_progress", "in_progress"]);
    });
  });

  it("同一个 agent 在同一个 project 只有一条索引 —— 因为只有一条 session", async () => {
    await runInDurableObject(p(), async (o) => {
      o.upsertSession({ agentId: "ferrule", title: "换了个标题" });
      const mine = o.listSessions().filter((x) => x.agentId === "ferrule");
      expect(mine).toHaveLength(1);
      expect(mine[0].title).toBe("换了个标题");
    });
  });

  it("状态可以标成 done", async () => {
    await runInDurableObject(p(), async (o) => {
      o.upsertSession({ agentId: "ferrule", status: "done" });
      const mine = o.listSessions().find((x) => x.agentId === "ferrule");
      expect(mine?.status).toBe("done");
      // 只改状态不该把标题冲掉
      expect(mine?.title).toBe("换了个标题");
    });
  });
});
