import { describe, expect, it } from "vitest";
import { PROJECT_TOOL_NAMES } from "../src/agent-tools";
import type { ActivityRow, MemberView } from "../src/api-types";
import {
  activityLine,
  collapseActivity,
  dayLabel,
  fileKind,
  parseAnchor,
  parseInline,
  relativeTime,
  toolLabel
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
      "Ferrule 写入了 pricing-table.tsx"
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
    expect(line.text).toBe("sable 写入了 pricing-table.tsx");
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

describe("工具名说人话", () => {
  it("project 注入的五个工具都有中文说法", () => {
    for (const name of PROJECT_TOOL_NAMES) {
      expect(toolLabel(name)).not.toBe(name);
    }
  });

  it("Think 内置的八个也有", () => {
    for (const name of ["read", "write", "edit", "list", "find", "grep", "delete", "bash"]) {
      expect(toolLabel(name)).not.toBe(name);
    }
  });

  // 编个说法比露出标识更糟 —— 用户会照着一个不存在的动作去理解。
  it("认不出的工具退回原名", () => {
    expect(toolLabel("someFutureTool")).toBe("someFutureTool");
  });
});

describe("行内 markdown", () => {
  it("没有记号时原样一段", () => {
    expect(parseInline("写完了")).toEqual([{ kind: "text", value: "写完了" }]);
  });

  it("反引号变成代码，反引号本身不出现在任何一段里", () => {
    const spans = parseInline("已写入公共区 `pricing-table.tsx`，version 1");
    expect(spans).toEqual([
      { kind: "text", value: "已写入公共区 " },
      { kind: "code", value: "pricing-table.tsx" },
      { kind: "text", value: "，version 1" }
    ]);
    expect(spans.some((s) => s.value.includes("`"))).toBe(false);
  });

  it("** 变成加粗", () => {
    expect(parseInline("这是 **终止信号**")).toEqual([
      { kind: "text", value: "这是 " },
      { kind: "strong", value: "终止信号" }
    ]);
  });

  // 落单的记号是正文的一部分，不能被吃掉。
  it("不成对的记号原样留着", () => {
    expect(parseInline("a ` b ** c")).toEqual([
      { kind: "text", value: "a ` b ** c" }
    ]);
  });

  // 跨行配对会把两段无关的话粘成一块代码。
  it("记号不跨行配对", () => {
    expect(parseInline("`a\nb`")).toEqual([{ kind: "text", value: "`a\nb`" }]);
  });
});

describe("链条断掉的两行", () => {
  const stalled = (verb: ActivityRow["verb"], detail: string | null): ActivityRow => ({
    id: 1,
    actorId: "verdigris",
    actorKind: "agent",
    verb,
    targetType: "session",
    targetId: "verdigris",
    detail,
    at: 0
  });

  it("失败的主语是 agent 自己", () => {
    const line = activityLine(stalled("failed", "ferrule 叫醒的那一轮"), MEMBERS);
    expect(line.text).toBe("Verdigris 没能完成这一轮");
    expect(line.detail).toBe("ferrule 叫醒的那一轮");
  });

  // detail 存的是 @ 的那个名字本身，不是 id —— 它可能根本不是成员。
  it("被拦下时说清是想叫谁，并告诉用户要接手", () => {
    const line = activityLine(stalled("blocked", "Sable"), MEMBERS);
    expect(line.text).toBe("Verdigris 想叫 Sable，被拦下了");
    expect(line.detail).toMatch(/接下一步/);
  });
});

describe("写入的版本号不裸接在句尾", () => {
  it("版本进副句", () => {
    const line = activityLine(
      {
        id: 2,
        actorId: "ferrule",
        actorKind: "agent",
        verb: "updated",
        targetType: "file",
        targetId: "pricing.tsx",
        detail: "v2",
        at: 0
      },
      MEMBERS
    );
    expect(line.text).toBe("Ferrule 写入了 pricing.tsx");
    expect(line.detail).toBe("现在是 v2");
  });
});

describe("折叠后的评论行", () => {
  const comment = (id: number, anchor: string | null): ActivityRow => ({
    id,
    actorId: "verdigris",
    actorKind: "agent",
    verb: "commented",
    targetType: "file",
    targetId: "pricing.tsx",
    detail: anchor,
    at: 0
  });

  // 只留第一条的 anchor 时，「留了 2 条 / 第 43 行」读起来像这两条
  // 都在说第 43 行 —— 而另一条说的是第 4 行。
  it("把几条的位置合起来，不是只留其中一条的", () => {
    const [only] = collapseActivity([comment(2, "第 43 行"), comment(1, "第 4 行")]);
    expect(only.count).toBe(2);
    expect(only.row.detail).toBe("第 43 行、第 4 行");
  });

  it("同一处不重复列", () => {
    const [only] = collapseActivity([comment(2, "第 4 行"), comment(1, "第 4 行")]);
    expect(only.row.detail).toBe("第 4 行");
  });

  it("都没有位置时不硬造一个", () => {
    const [only] = collapseActivity([comment(2, null), comment(1, null)]);
    expect(only.row.detail).toBeNull();
  });

  it("不折叠不同人的评论", () => {
    const other = { ...comment(1, "第 4 行"), actorId: "ferrule" };
    expect(collapseActivity([comment(2, "第 43 行"), other])).toHaveLength(2);
  });
});
