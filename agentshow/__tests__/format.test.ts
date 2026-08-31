import { describe, expect, it } from "vitest";
import type { ActivityRow, MemberView } from "../src/api-types";
import {
  activityLine,
  collapseActivity,
  dayLabel,
  fileKind,
  parseAnchor,
  relativeTime
} from "../src/ui/format";

const MEMBERS: MemberView[] = [
  { memberId: "ferrule", kind: "agent", name: "Ferrule" },
  { memberId: "verdigris", kind: "agent", name: "Verdigris" },
  { memberId: "demo@agentshow.io", kind: "human", name: "demo" }
];

const NOW = new Date("2026-08-31T15:00:00+08:00").getTime();
const MIN = 60_000;

function row(p: Partial<ActivityRow>): ActivityRow {
  return {
    id: 1,
    actorId: "ferrule",
    actorKind: "agent",
    verb: "updated",
    targetType: "file",
    targetId: "pricing-table.tsx",
    detail: null,
    at: NOW,
    ...p
  };
}

describe("relativeTime", () => {
  it("一分钟内是刚刚", () => {
    expect(relativeTime(NOW - 30_000, NOW)).toBe("刚刚");
  });

  it("小时内给分钟", () => {
    expect(relativeTime(NOW - 3 * MIN, NOW)).toBe("3 分钟前");
  });

  it("同一天给小时", () => {
    expect(relativeTime(NOW - 3 * 60 * MIN, NOW)).toBe("3 小时前");
  });

  it("跨到前一天是昨天", () => {
    expect(relativeTime(NOW - 20 * 60 * MIN, NOW)).toBe("昨天");
  });
});

describe("dayLabel", () => {
  it("分组标题只区分今天、昨天和具体日期", () => {
    expect(dayLabel(NOW, NOW)).toBe("今天");
    expect(dayLabel(NOW - 20 * 60 * MIN, NOW)).toBe("昨天");
    expect(dayLabel(NOW - 5 * 24 * 60 * MIN, NOW)).not.toBe("昨天");
  });
});

describe("fileKind", () => {
  it("按扩展名分类，认不出的归 other", () => {
    expect(fileKind("pricing-table.tsx")).toBe("code");
    expect(fileKind("定价文案.md")).toBe("doc");
    expect(fileKind("竞品定价对照.csv")).toBe("sheet");
    expect(fileKind("README")).toBe("other");
  });
});

describe("parseAnchor", () => {
  it("认得工具说明里给的那种写法", () => {
    expect(parseAnchor("第 42 行")).toEqual({ from: 42, to: 42 });
    expect(parseAnchor("第 9-26 行")).toEqual({ from: 9, to: 26 });
    expect(parseAnchor("第 9–26 行")).toEqual({ from: 9, to: 26 });
    expect(parseAnchor("42行")).toEqual({ from: 42, to: 42 });
  });

  // anchor 是自由文本，指不到行的说法同样有用 —— 只是不高亮。
  it("指不到行的照样是合法 anchor，只是没有行号", () => {
    expect(parseAnchor("整体")).toBeNull();
    expect(parseAnchor("表头那一块")).toBeNull();
    expect(parseAnchor(null)).toBeNull();
  });

  it("倒过来的范围当作认不出，不去猜用户的意思", () => {
    expect(parseAnchor("第 26-9 行")).toBeNull();
  });
});

describe("collapseActivity", () => {
  const comment = (id: number, actor: string, target: string) =>
    row({ id, actorId: actor, verb: "commented", targetId: target });

  it("连续的同人同文件评论折成一条", () => {
    const out = collapseActivity([
      comment(3, "verdigris", "pricing-table.tsx"),
      comment(2, "verdigris", "pricing-table.tsx"),
      comment(1, "verdigris", "pricing-table.tsx")
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].count).toBe(3);
    // 保留最新那条，时间和锚点都跟着它。
    expect(out[0].row.id).toBe(3);
  });

  it("换人或换文件就断开", () => {
    const out = collapseActivity([
      comment(4, "verdigris", "a.md"),
      comment(3, "verdigris", "b.md"),
      comment(2, "ferrule", "b.md"),
      comment(1, "ferrule", "b.md")
    ]);
    expect(out.map((x) => x.count)).toEqual([1, 1, 2]);
  });

  // 写入不折叠：v1→v2→v3 的推进本身就是要看的东西。
  it("写入永远逐条列出", () => {
    const out = collapseActivity([
      row({ id: 2, verb: "updated", detail: "v2" }),
      row({ id: 1, verb: "updated", detail: "v1" })
    ]);
    expect(out.map((x) => x.count)).toEqual([1, 1]);
  });
});

describe("activityLine", () => {
  // 这个产品的整个论点就是这一句：主语是 agent 的名字，不是 id。
  it("主语是行动者的名字", () => {
    expect(activityLine(row({ detail: "v3" }), MEMBERS).text).toBe(
      "Ferrule 写入 pricing-table.tsx v3"
    );
  });

  it("人和 agent 在句子里没有语法差别", () => {
    const line = activityLine(
      row({ actorId: "demo@agentshow.io", actorKind: "human", verb: "created" }),
      MEMBERS
    );
    expect(line.text).toBe("demo 创建了 pricing-table.tsx");
  });

  // 记录发生在被拒的那一刻，重做成没成功还不知道 —— 不能说「重做了」。
  it("撞车只说撞车，并把两个版本号拆成人话", () => {
    const line = activityLine(
      row({ verb: "rejected", detail: "v1→v2" }),
      MEMBERS
    );
    expect(line.text).toBe("Ferrule 的写入撞上了别人的改动");
    expect(line.detail).toBe("手上是 v1，公共区已经是 v2");
    expect(line.badge.label).toBe("重做");
  });

  it("提及把被提及方的 id 也解析成名字", () => {
    const line = activityLine(
      row({ verb: "mentioned", detail: "verdigris" }),
      MEMBERS
    );
    expect(line.text).toBe("Ferrule 提及了 Verdigris，在 pricing-table.tsx");
  });

  it("解析不到的 id 退回原样 —— 成员被移出后他做过的事还在流里", () => {
    const line = activityLine(row({ actorId: "sable", detail: "v1" }), MEMBERS);
    expect(line.text).toBe("sable 写入 pricing-table.tsx v1");
  });

  it("折叠后的评论说总数", () => {
    const line = activityLine(row({ verb: "commented" }), MEMBERS, 5);
    expect(line.text).toBe("Ferrule 复审了 pricing-table.tsx，留了 5 条");
  });

  it("加人记在成员分类下，显示的是名字不是 id", () => {
    const line = activityLine(
      row({
        actorId: "demo@agentshow.io",
        actorKind: "human",
        verb: "joined",
        targetType: "member",
        targetId: "verdigris",
        detail: "Verdigris"
      }),
      MEMBERS
    );
    expect(line.text).toBe("demo 把 Verdigris 加进了这个项目");
    expect(line.badge.label).toBe("成员");
  });
});
