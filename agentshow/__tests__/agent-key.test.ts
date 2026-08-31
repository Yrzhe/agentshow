import { describe, expect, it } from "vitest";
import { agentKey, parseAgentKey, scoped, unscope } from "../src/agent-key";

/**
 * DO 实例名就是 session 的身份：`${owner}~${agentId}:${projectId}`。
 * 所有者前缀是这套东西唯一的租户边界 —— 没有它，两个人各建一个叫 demo 的
 * project 就共用同一个 ProjectDO 实例。
 */
describe("agentKey / parseAgentKey", () => {
  const OWNER = "yrzhe@yrzhe.space";

  it("往返一致", () => {
    expect(parseAgentKey(agentKey(OWNER, "ferrule", "pricing"))).toEqual({
      owner: OWNER,
      agentId: "ferrule",
      projectId: "pricing"
    });
  });

  it("DM 的 projectId 是 null", () => {
    expect(agentKey(OWNER, "ferrule")).toBe(`${OWNER}~ferrule:dm`);
    expect(parseAgentKey(`${OWNER}~ferrule:dm`)).toEqual({
      owner: OWNER,
      agentId: "ferrule",
      projectId: null
    });
  });

  it("同一对永远得到同一个 key —— 这是 session 复用的依据", () => {
    expect(agentKey(OWNER, "verdigris", "pricing")).toBe(
      agentKey(OWNER, "verdigris", "pricing")
    );
    expect(agentKey(OWNER, "verdigris", "pricing")).not.toBe(
      agentKey(OWNER, "verdigris", "sea")
    );
  });

  // 这一条是租户边界本身：同名 agent + 同名 project，不同的人，必须是不同实例。
  it("换个所有者就是另一个实例", () => {
    expect(agentKey("a@x.com", "ferrule", "pricing")).not.toBe(
      agentKey("b@x.com", "ferrule", "pricing")
    );
  });

  describe("形状不对一律返回 null —— 兜默认值会让越权变成静默的", () => {
    it("没有所有者前缀的裸名字（就是修复前的老格式）", () => {
      expect(parseAgentKey("ferrule:pricing")).toBeNull();
      expect(parseAgentKey("ferrule")).toBeNull();
    });

    it("空所有者", () => {
      expect(parseAgentKey("~ferrule:pricing")).toBeNull();
    });

    it("没有冒号", () => {
      expect(parseAgentKey(`${OWNER}~ferrule`)).toBeNull();
    });

    it("agentId 或 projectId 不是合法 slug", () => {
      expect(parseAgentKey(`${OWNER}~Ferrule:pricing`)).toBeNull();
      expect(parseAgentKey(`${OWNER}~ferrule:a:b`)).toBeNull();
      expect(parseAgentKey(`${OWNER}~ferrule:../etc`)).toBeNull();
      expect(parseAgentKey(`${OWNER}~:pricing`)).toBeNull();
    });
  });

  // 邮箱里出现斜杠或冒号都是合法的，解析顺序必须扛得住。
  describe("古怪但合法的邮箱", () => {
    it("带 ~ 的邮箱按最后一个 ~ 切", () => {
      const weird = 'a~b@x.com';
      expect(parseAgentKey(agentKey(weird, "ferrule", "pricing"))).toEqual({
        owner: weird,
        agentId: "ferrule",
        projectId: "pricing"
      });
    });

    it("带冒号的邮箱不会把 agentId 切错", () => {
      const weird = '"a:b"@x.com';
      expect(parseAgentKey(agentKey(weird, "ferrule", "pricing"))).toEqual({
        owner: weird,
        agentId: "ferrule",
        projectId: "pricing"
      });
    });
  });
});

describe("scoped / unscope", () => {
  it("往返一致", () => {
    expect(unscope(scoped("a@x.com", "pricing"))).toEqual({
      owner: "a@x.com",
      slug: "pricing"
    });
  });

  it("带 ~ 的邮箱按最后一个 ~ 切", () => {
    expect(unscope(scoped("a~b@x.com", "pricing"))).toEqual({
      owner: "a~b@x.com",
      slug: "pricing"
    });
  });
});
