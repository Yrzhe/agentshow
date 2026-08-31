import { describe, expect, it } from "vitest";
import { checkAgentRoute } from "../src/agent-route";
import { agentKey } from "../src/agent-key";

/**
 * 路由闸是 A-1 的修复。Access 只回答「能不能进站」，
 * 进来之后实例名是客户端给的 —— 这一层是唯一挡住「连别人 session」的东西。
 * 所以它的形状边界要被逐条钉住。
 */

const ME = "me@yrzhe.space";
const OTHER = "other@youware.com";
const mine = agentKey(ME, "ferrule", "pricing");
const theirs = agentKey(OTHER, "ferrule", "pricing");

const k = (path: string, as = ME) =>
  checkAgentRoute(new URL(`https://x.io${path}`), as).kind;

describe("路由闸的形状边界", () => {
  it("正常形状", () => {
    expect(k(`/agents/agent-d-o/${mine}/get-messages`)).toBe("ok");
    expect(k(`/agents/agent-d-o/${theirs}/get-messages`)).toBe("deny");
  });

  it("URL 编码的实例名", () => {
    expect(k(`/agents/agent-d-o/${encodeURIComponent(mine)}/x`)).toBe("ok");
    expect(k(`/agents/agent-d-o/${encodeURIComponent(theirs)}/x`)).toBe("deny");
    // %7E 是 ~，%3A 是 :
    expect(k(`/agents/agent-d-o/me@yrzhe.space%7Eferrule%3Apricing/x`)).toBe("ok");
  });

  it("双重编码不该变成放行", () => {
    // decodeURIComponent 只解一次，%257E 解成 %7E，不是 ~ → 解析失败 → deny
    expect(k(`/agents/agent-d-o/me@yrzhe.space%257Eferrule%253Apricing/x`)).toBe("deny");
  });

  it("没有实例名的短路径不拦，交给 SDK 自己 404", () => {
    expect(k(`/agents`)).toBe("not-agent");
    expect(k(`/agents/`)).toBe("not-agent");
    expect(k(`/agents/agent-d-o`)).toBe("not-agent");
    expect(k(`/agents/agent-d-o/`)).toBe("not-agent");
  });

  it("多余的斜杠不会把实例名挤出 parts[1]", () => {
    // filter(Boolean) 吃掉空段，所以 //x// 和 /x/ 一样
    expect(k(`/agents//agent-d-o//${theirs}//x`)).toBe("deny");
  });

  it("路径遍历段不会绕开", () => {
    expect(k(`/agents/agent-d-o/../${theirs}/x`)).toBe("deny");
    expect(k(`/agents/./agent-d-o/${theirs}/x`)).toBe("deny");
  });

  it("大小写不同的邮箱不算同一个人 —— 宁可误拒", () => {
    expect(k(`/agents/agent-d-o/${agentKey("ME@yrzhe.space", "f", "p")}/x`)).toBe("deny");
  });

  it("非 agent 路径一概不管", () => {
    expect(k("/")).toBe("not-agent");
    expect(k("/api/me")).toBe("not-agent");
    expect(k("/agentsomething/x")).toBe("not-agent");
  });
});
