import type { Detail, Tab } from "./ProjectPanel";

/**
 * 界面位置放进地址栏。
 *
 * 不做这件事的代价是两条：手抖刷新一次就回到第一个项目、会话列表、概览 tab，
 * 刚才在看的东西全丢（而 agent 正在跑的时候人最容易去刷）；以及没法把
 * 「Verdigris 的这条 session」发给同事看 —— 地址栏从头到尾不变。
 *
 * 推理本身不受影响：消息住在 AgentDO 里，丢的纯粹是位置。
 */

export type AppLocation = {
  projectId: string | null;
  /** 开着的会话是哪个 agent 的。null 表示停在会话列表。 */
  session: string | null;
  tab: Tab;
  detail: Detail;
};

/** tab 的界面文案是中文，地址栏里用 ascii —— 中文在链接里会被转成一串 %E6。 */
const TAB_KEY: Record<Tab, string> = {
  概览: "overview",
  文件: "files",
  活动: "activity",
  成员: "members"
};
const TAB_OF_KEY = Object.fromEntries(
  Object.entries(TAB_KEY).map(([tab, key]) => [key, tab as Tab])
) as Record<string, Tab>;

export const HOME: AppLocation = {
  projectId: null,
  session: null,
  tab: "概览",
  detail: null
};

export function readLocation(search: string): AppLocation {
  const q = new URLSearchParams(search);
  const file = q.get("file");
  const agent = q.get("agent");

  return {
    projectId: q.get("p"),
    session: q.get("s"),
    tab: TAB_OF_KEY[q.get("tab") ?? ""] ?? "概览",
    // 文件优先。两个都给的时候只能开一个，而地址栏里同时出现它俩
    // 只可能是手拼出来的。
    detail: file
      ? { kind: "file", path: file }
      : agent
        ? { kind: "agent", agentId: agent }
        : null
  };
}

/** 只写非默认值 —— 首页的地址栏应该是干净的。 */
export function toSearch(loc: AppLocation): string {
  const q = new URLSearchParams();
  if (loc.projectId) q.set("p", loc.projectId);
  if (loc.session) q.set("s", loc.session);
  if (loc.tab !== "概览") q.set("tab", TAB_KEY[loc.tab]);
  if (loc.detail?.kind === "file") q.set("file", loc.detail.path);
  if (loc.detail?.kind === "agent") q.set("agent", loc.detail.agentId);
  const s = q.toString();
  return s ? `?${s}` : "";
}
