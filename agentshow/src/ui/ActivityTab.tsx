import { useEffect, useState } from "react";
import type { ActivityPage, ProjectView } from "../api-types";
import {
  ACTIVITY_FILTERS,
  type ActivityFilterKey,
  type CollapsedActivity,
  clockTime,
  collapseActivity,
  dayLabel,
  relativeTime
} from "./format";
import { ActivityItem } from "./rows";

/**
 * 活动的完整流。
 *
 * 这一屏是整个产品的论点：从上往下读，主语几乎全是 agent。
 * 筛选和分组都在已经拿到的数据上做；只有往回翻才发请求。
 */
export function ActivityTab({
  project,
  now
}: {
  project: ProjectView;
  now?: number;
}) {
  const [filter, setFilter] = useState<ActivityFilterKey>("all");
  const t = now ?? Date.now();
  const { rows: all, hasMore, loadMore, loading } = useActivity(project);

  const active = ACTIVITY_FILTERS.find((f) => f.key === filter)!;
  const rows = active.verbs
    ? all.filter((r) => (active.verbs as readonly string[]).includes(r.verb))
    : all;

  // 折叠先做，条数从折叠后的结果来。
  //
  // 头上的数字和底下的行必须是同一个东西：一次复审的五条评论折叠成一行，
  // 而头部还按折叠前数，最糟的时候「4 条」底下只有两行，每行自己还写着
  // 「留了 2 条」。
  const items = collapseActivity(rows);

  return (
    <div className="flex flex-col pb-6">
      <div className="flex items-baseline gap-2 pt-4 pb-3 px-4.5">
        <span className="font-bold text-[#121313] text-base/5 tracking-[-0.01em]">
          活动
        </span>
        <span className="text-[#777777] text-[10px]/3">{items.length} 条</span>
      </div>

      <div className="flex items-center pb-3.5 gap-1.5 px-4.5">
        {ACTIVITY_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={f.key === filter}
            onClick={() => setFilter(f.key)}
            className={`h-6 flex items-center px-2.75 rounded-md font-medium text-[10px]/3 ${
              f.key === filter
                ? "bg-[#121313] text-white"
                : "border border-[#E4E4E4] text-[#555555] hover:bg-[#F5F5F5]"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {groupByDay(items, t).map(([day, group]) => (
        <div key={day} className="flex flex-col">
          <div className="pt-3.5 pb-1.5 px-4.5">
            <span className="font-semibold text-[#999999] text-[10px]/3 tracking-[0.06em]">
              {day}
            </span>
          </div>
          {group.map(({ row, count }) => (
            <ActivityItem
              key={row.id}
              row={row}
              count={count}
              members={project.members}
              now={t}
              // 今天的用相对时间（「3 分钟前」），更早的分组标题已经给了日期，
              // 行里给时刻更有用。
              timeText={
                day === "今天" ? relativeTime(row.at, t) : clockTime(row.at)
              }
            />
          ))}
        </div>
      ))}

      {items.length === 0 && (
        <div className="px-4.5 py-8 text-[#A5A5A5] text-[11px]/4">
          这个分类下还没有动静。
        </div>
      )}

      {hasMore && (
        <div className="px-4.5 pt-4">
          <button
            type="button"
            onClick={loadMore}
            disabled={loading}
            className="h-7 px-3 rounded-md border border-[#E4E4E4] text-[#555555] font-medium text-[10px]/3 hover:bg-[#F5F5F5] disabled:text-[#B4B4B4]"
          >
            {loading ? "正在取" : "更早的"}
          </button>
        </div>
      )}
    </div>
  );
}

/** 展开一次多给这么多条，和服务端 project 快照里那一页对齐。 */
const PAGE = 50;

/**
 * 没展开时用 project 快照里带的那一页；展开之后自己取一整段。
 *
 * 要「最近 N 条」而不是「某条之前的一页」：快照每 4 秒重取一次，
 * 而按游标翻出来的那一页是按当时的边界取的，期间新来的活动会掉进
 * 两段之间。整段重取没有这个缝。
 */
function useActivity(project: ProjectView) {
  const [pages, setPages] = useState(1);
  const [expanded, setExpanded] = useState<ActivityPage | null>(null);
  const [loading, setLoading] = useState(false);
  const { projectId, activity, activityHasMore } = project;

  // 依赖 activity 本身：轮询每次给的是一个新数组，展开的那段跟着一起刷新。
  useEffect(() => {
    if (pages === 1) {
      setExpanded(null);
      return;
    }
    let live = true;
    setLoading(true);
    fetch(`/api/projects/${projectId}/activity?limit=${pages * PAGE}`)
      .then((r) => (r.ok ? (r.json() as Promise<ActivityPage>) : null))
      .then((page) => {
        if (live && page) setExpanded(page);
      })
      // 取不到就保持上一段，「更早的」还在，用户可以再点一次。
      .catch(() => {})
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [pages, projectId, activity]);

  // 换 project 时 pages 要回到 1，否则新项目一进去就按上一个的展开程度取。
  const [lastProject, setLastProject] = useState(projectId);
  if (lastProject !== projectId) {
    setLastProject(projectId);
    setPages(1);
    setExpanded(null);
  }

  return {
    rows: expanded?.activity ?? activity,
    hasMore: expanded ? expanded.hasMore : activityHasMore,
    loadMore: () => setPages((n) => n + 1),
    loading
  };
}

/** 保持后端给的倒序，只在相邻同一天的行之间插分组标题。 */
function groupByDay(
  items: CollapsedActivity[],
  now: number
): [string, CollapsedActivity[]][] {
  return items.reduce<[string, CollapsedActivity[]][]>((out, item) => {
    const day = dayLabel(item.row.at, now);
    const last = out[out.length - 1];
    if (last && last[0] === day) {
      return [...out.slice(0, -1), [day, [...last[1], item]]];
    }
    return [...out, [day, [item]]];
  }, []);
}
