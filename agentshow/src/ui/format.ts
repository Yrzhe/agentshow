import type { ActivityRow, MemberView } from "../api-types";

/** 界面上所有「把数据变成字」的逻辑。纯函数，好测也好改文案。 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** 「刚刚 / 3 分钟前 / 昨天」。now 传进来而不是内部取，为了可测。 */
export function relativeTime(at: number, now: number): string {
  const d = now - at;
  if (d < MINUTE) return "刚刚";
  if (d < HOUR) return `${Math.floor(d / MINUTE)} 分钟前`;
  if (sameDay(at, now)) return `${Math.floor(d / HOUR)} 小时前`;
  if (sameDay(at, now - 24 * HOUR)) return "昨天";
  return new Date(at).toLocaleDateString("zh-CN", {
    month: "numeric",
    day: "numeric"
  });
}

function sameDay(a: number, b: number): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return (
    x.getFullYear() === y.getFullYear() &&
    x.getMonth() === y.getMonth() &&
    x.getDate() === y.getDate()
  );
}

/** 活动流按天分组的标题。 */
export function dayLabel(at: number, now: number): string {
  if (sameDay(at, now)) return "今天";
  if (sameDay(at, now - 24 * HOUR)) return "昨天";
  return new Date(at).toLocaleDateString("zh-CN", {
    month: "long",
    day: "numeric"
  });
}

export function clockTime(at: number): string {
  return new Date(at).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

export type FileKind = "code" | "doc" | "sheet" | "other";

const CODE = new Set(["ts", "tsx", "js", "jsx", "css", "html", "py", "go", "rs"]);
const DOC = new Set(["md", "txt"]);
const SHEET = new Set(["csv", "tsv"]);

export function fileKind(path: string): FileKind {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (CODE.has(ext)) return "code";
  if (DOC.has(ext)) return "doc";
  if (SHEET.has(ext)) return "sheet";
  return "other";
}

export const FILE_KIND_LABEL: Record<FileKind, string> = {
  code: "代码",
  doc: "文档",
  sheet: "表格",
  other: "文件"
};

/** 图标描边色。文件类型在列表里是一眼扫过去的信息，靠颜色比靠文字快。 */
export const FILE_KIND_COLOR: Record<FileKind, string> = {
  code: "#5B7FBF",
  doc: "#6E6E6E",
  sheet: "#4A8B62",
  other: "#8A8A8A"
};

export type Badge = { label: string; bg: string; fg: string };

const BADGE: Record<string, Badge> = {
  file: { label: "文件", bg: "#EDEDED", fg: "#6E6E6E" },
  redo: { label: "重做", bg: "#F1EEE6", fg: "#8A7A4A" },
  comment: { label: "评论", bg: "#F4EFE9", fg: "#8A6A4A" },
  mention: { label: "提及", bg: "#E8F0EC", fg: "#2E7D68" },
  session: { label: "会话", bg: "#E8F0EC", fg: "#2E7D68" },
  member: { label: "成员", bg: "#EDEDED", fg: "#6E6E6E" }
};

export type ActivityLine = {
  /** 主句。主语永远是行动者的名字 —— agent 和人在这里没有语法差别。 */
  text: string;
  /** 副句，不含时间；时间由组件接在后面。 */
  detail?: string;
  badge: Badge;
};

/**
 * 一行活动变成一句话。
 *
 * 名字用 `members` 解析：活动表里存的是 id，而 id 在界面上没有意义。
 * 解析不到就退回 id —— 成员被移出 project 之后，他做过的事仍然在流里。
 */
export function activityLine(
  row: ActivityRow,
  members: MemberView[],
  /** 这一行代表几条 —— 连续的同人同文件评论会折叠成一条。 */
  count = 1
): ActivityLine {
  const who = nameOf(row.actorId, members);
  const what = row.targetId;

  switch (row.verb) {
    case "created":
      return { text: `${who} 创建了 ${what}`, badge: BADGE.file };

    case "updated":
      return {
        text: `${who} 写入 ${what} ${row.detail ?? ""}`.trim(),
        badge: BADGE.file
      };

    // 记录发生在拒绝的那一刻，重做成不成功还不知道 —— 所以只说撞车，
    // 不说「重做成功了」。重做本身会作为紧随其后的一条 updated 出现。
    case "rejected":
      return {
        text: `${who} 的写入撞上了别人的改动`,
        detail: versionClash(row.detail),
        badge: BADGE.redo
      };

    case "commented":
      return {
        text:
          count > 1
            ? `${who} 复审了 ${what}，留了 ${count} 条`
            : `${who} 在 ${what} 上留了一条评论`,
        detail: row.detail ?? undefined,
        badge: BADGE.comment
      };

    case "mentioned":
      return {
        text: `${who} 提及了 ${nameOf(row.detail ?? "", members)}，在 ${what}`,
        badge: BADGE.mention
      };

    case "joined":
      return {
        text: `${who} 把 ${row.detail ?? what} 加进了这个项目`,
        badge: BADGE.member
      };

    case "completed":
      return { text: `${who} 把「${what}」标记为已完成`, badge: BADGE.session };
  }
}

/** 存的是 `v1→v2`：他手上那一版，和公共区当时的那一版。 */
function versionClash(detail: string | null): string | undefined {
  if (!detail) return undefined;
  const [base, current] = detail.split("→");
  if (!base || !current) return detail;
  return `手上是 ${base}，公共区已经是 ${current}`;
}

export type CollapsedActivity = { row: ActivityRow; count: number };

/**
 * 一次复审会留下五六条评论，逐条列出来就是一堵重复的墙，
 * 把它前后真正不同的事件挤出视野。
 *
 * 只折叠连续的、同一个人在同一个文件上的评论 —— 写入不折叠：
 * v1→v2→v3 的推进本身就是要看的东西。
 */
export function collapseActivity(rows: ActivityRow[]): CollapsedActivity[] {
  const out: CollapsedActivity[] = [];
  for (const row of rows) {
    const last = out[out.length - 1];
    const mergeable =
      last &&
      row.verb === "commented" &&
      last.row.verb === "commented" &&
      last.row.actorId === row.actorId &&
      last.row.targetId === row.targetId;

    if (mergeable) last.count += 1;
    else out.push({ row, count: 1 });
  }
  return out;
}

export function nameOf(id: string, members: MemberView[]): string {
  return members.find((m) => m.memberId === id)?.name ?? id;
}

export function memberOf(
  id: string,
  members: MemberView[]
): MemberView | undefined {
  return members.find((m) => m.memberId === id);
}

/** 活动流顶部的筛选。分类按「看的人在找什么」分，不按 verb 一一对应。 */
export const ACTIVITY_FILTERS = [
  { key: "all", label: "全部", verbs: null },
  { key: "file", label: "文件", verbs: ["created", "updated", "rejected"] },
  { key: "mention", label: "提及", verbs: ["mentioned"] },
  { key: "comment", label: "评论", verbs: ["commented"] },
  { key: "member", label: "成员", verbs: ["joined"] }
] as const;

export type ActivityFilterKey = (typeof ACTIVITY_FILTERS)[number]["key"];
