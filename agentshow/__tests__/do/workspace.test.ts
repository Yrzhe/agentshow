/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

/**
 * 工作台按人记账：ProjectDO 和 AgentIdentityDO 都按名字寻址，
 * 「我有哪些 project」在它们里面问不出来。
 */

const w = () => env.WorkspaceDO.get(env.WorkspaceDO.idFromName("love@yrzhe.space"));

describe("WorkspaceDO", () => {
  it("按加入顺序列出 project", async () => {
    await runInDurableObject(w(), async (o) => {
      o.addProject({ projectId: "pricing", name: "定价页改版" });
      o.addProject({ projectId: "sea-saas", name: "SEA SaaS 调研" });

      expect(o.listProjects().map((p) => p.projectId)).toEqual([
        "pricing",
        "sea-saas"
      ]);
    });
  });

  // seed 脚本要能重复跑。同 id 再写一次是改名，不是长出第二个 project。
  it("同 id 重复写入是改名，不是新增", async () => {
    await runInDurableObject(w(), async (o) => {
      o.addProject({ projectId: "pricing", name: "定价页 v2" });

      expect(o.listProjects()).toHaveLength(2);
      expect(o.getProject("pricing")?.name).toBe("定价页 v2");
    });
  });

  it("查不存在的 project 返回 null", async () => {
    await runInDurableObject(w(), async (o) => {
      expect(o.getProject("nope")).toBeNull();
    });
  });

  it("agent 只记 id —— 名字和头像住在 AgentIdentityDO，抄一份会漂", async () => {
    await runInDurableObject(w(), async (o) => {
      o.addAgent("ferrule");
      o.addAgent("verdigris");
      o.addAgent("ferrule");

      expect(o.listAgents()).toEqual(["ferrule", "verdigris"]);
    });
  });
});
