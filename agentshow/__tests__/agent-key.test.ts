import { describe, expect, it } from "vitest";
import { agentKey, parseAgentKey } from "../src/agent-key";

/**
 * DO 实例名就是 session 的身份：`${agentId}:${projectId}`。
 * 这一对确定性地映射到同一个 DO 实例，所以不需要另造 sessionId。
 */
describe("agentKey / parseAgentKey", () => {
  it("往返一致", () => {
    expect(parseAgentKey(agentKey("ferrule", "pricing"))).toEqual({
      agentId: "ferrule",
      projectId: "pricing"
    });
  });

  it("DM 的 projectId 是 null", () => {
    expect(agentKey("ferrule", null)).toBe("ferrule:dm");
    expect(parseAgentKey("ferrule:dm")).toEqual({ agentId: "ferrule", projectId: null });
  });

  it("project id 里含冒号时只按第一个冒号切", () => {
    expect(parseAgentKey("ferrule:a:b:c")).toEqual({
      agentId: "ferrule",
      projectId: "a:b:c"
    });
  });

  it("同一对永远得到同一个 key —— 这是 session 复用的依据", () => {
    expect(agentKey("verdigris", "pricing")).toBe(agentKey("verdigris", "pricing"));
    expect(agentKey("verdigris", "pricing")).not.toBe(agentKey("verdigris", "sea"));
  });

  it("没有冒号的名字视为 DM，不抛异常", () => {
    expect(parseAgentKey("ferrule")).toEqual({ agentId: "ferrule", projectId: null });
  });
});
