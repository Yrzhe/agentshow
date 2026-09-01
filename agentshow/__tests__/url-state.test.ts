import { describe, expect, it } from "vitest";
import { readLocation, toSearch } from "../src/ui/url-state";
import type { AppLocation } from "../src/ui/url-state";

/**
 * 地址栏是这个应用唯一的位置存储。它答错的后果有两种：
 * 刷新之后落回起点（丢的是用户刚才在看的东西），
 * 或者把一条链接发给同事，对方打开看到的不是同一屏。
 */

const HOME: AppLocation = {
  projectId: null,
  session: null,
  tab: "概览",
  detail: null
};

describe("读地址栏", () => {
  it("空地址是起点", () => {
    expect(readLocation("")).toEqual(HOME);
  });

  it("四件事都读得出来", () => {
    expect(readLocation("?p=pricing&s=verdigris&tab=activity")).toEqual({
      projectId: "pricing",
      session: "verdigris",
      tab: "活动",
      detail: null
    });
  });

  it("文件详情带路径", () => {
    expect(readLocation("?p=pricing&file=src%2Fpricing.tsx").detail).toEqual({
      kind: "file",
      path: "src/pricing.tsx"
    });
  });

  it("身份卡带 agentId", () => {
    expect(readLocation("?agent=ferrule").detail).toEqual({
      kind: "agent",
      agentId: "ferrule"
    });
  });

  // 手拼出来的地址不该让界面崩在一个说不清的状态上。
  it("认不出的 tab 回到概览", () => {
    expect(readLocation("?tab=nonsense").tab).toBe("概览");
  });

  it("同时给文件和身份卡时只开文件", () => {
    expect(readLocation("?file=a.md&agent=ferrule").detail).toEqual({
      kind: "file",
      path: "a.md"
    });
  });
});

describe("写地址栏", () => {
  it("起点是干净的地址", () => {
    expect(toSearch(HOME)).toBe("");
  });

  it("默认值不写进去", () => {
    expect(toSearch({ ...HOME, projectId: "pricing" })).toBe("?p=pricing");
  });

  it("tab 用 ascii —— 中文在链接里会变成一串百分号", () => {
    const s = toSearch({ ...HOME, projectId: "p", tab: "成员" });
    expect(s).toBe("?p=p&tab=members");
    expect(s).not.toMatch(/%/);
  });
});

describe("读回来的和写出去的是同一个位置", () => {
  const cases: AppLocation[] = [
    HOME,
    { projectId: "pricing", session: null, tab: "文件", detail: null },
    {
      projectId: "pricing",
      session: "verdigris",
      tab: "活动",
      detail: null
    },
    {
      projectId: "pricing",
      session: null,
      tab: "概览",
      detail: { kind: "file", path: "src/定价表.tsx" }
    },
    {
      projectId: "pricing",
      session: "ferrule",
      tab: "概览",
      detail: { kind: "agent", agentId: "ferrule" }
    }
  ];

  it.each(cases)("往返不变形 %#", (loc) => {
    expect(readLocation(toSearch(loc))).toEqual(loc);
  });
});
