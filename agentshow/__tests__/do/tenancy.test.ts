/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { handleApi } from "../../src/api";
import { checkAgentRoute } from "../../src/agent-route";
import { agentKey } from "../../src/agent-key";

/**
 * 租户边界的回归测试。
 *
 * 这两条在修复前都是可复现的越权（A-1 / A-2）：
 * 任意登录者连别人的 session；建同名 project/agent 读别人的数据。
 * 边界靠 DO 实例名的所有者前缀 + routeAgentRequest 之前的那道闸维持，
 * 两者少一个都会重新打开。
 */

const A = "owner@yrzhe.space";
const B = "intruder@youware.com";

const get = (p: string, as: string) =>
  handleApi(new Request(`https://agentshow.io${p}`), env, as);
const post = (p: string, body: unknown, as: string) =>
  handleApi(
    new Request(`https://agentshow.io${p}`, {
      method: "POST",
      body: JSON.stringify(body)
    }),
    env,
    as
  );

describe("A-2 越权已封", () => {
  it("建同名 project 拿不到别人的文件", async () => {
    await post("/api/projects", { projectId: "vp", name: "机密" }, A);
    await post("/api/projects/vp/comments", { path: "s.md", text: "x" }, A);

    await post("/api/projects", { projectId: "vp", name: "我的" }, B);
    const detail = await get("/api/projects/vp/file?path=s.md", B);
    // B 现在有自己的同名 project，但它是另一个实例，里面什么都没有
    expect(detail?.status).toBe(404);
  });

  it("建同名 agent 拿不到别人的身份文档", async () => {
    await post("/api/agents", { agentId: "va", name: "V", soul: "私密" }, A);
    await post("/api/agents", { agentId: "va", name: "我的" }, B);

    const card = await get("/api/agents/va", B);
    const body = (await card!.json()) as { identityDoc: string };
    expect(body.identityDoc).not.toBe("私密");
  });
});

describe("A-1 agent 路由已上闸", () => {
  const u = (name: string) =>
    new URL(`https://agentshow.io/agents/agent-d-o/${encodeURIComponent(name)}/get-messages`);

  it("自己的实例放行", () => {
    expect(checkAgentRoute(u(agentKey(A, "ferrule", "pricing")), A).kind).toBe("ok");
  });

  it("别人的实例拒绝", () => {
    expect(checkAgentRoute(u(agentKey(A, "ferrule", "pricing")), B).kind).toBe("deny");
  });

  it("修复前的裸实例名一律拒绝", () => {
    expect(checkAgentRoute(u("ferrule:pricing"), A).kind).toBe("deny");
    expect(checkAgentRoute(u("ferrule"), A).kind).toBe("deny");
  });

  it("非 agent 路径不拦", () => {
    expect(checkAgentRoute(new URL("https://agentshow.io/"), A).kind).toBe("not-agent");
  });
});
