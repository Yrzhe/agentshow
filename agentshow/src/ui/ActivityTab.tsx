import { useState } from "react";
import type { ProjectView } from "../api-types";
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
 * 筛选和分组都在已经拿到的数据上做，不再发请求。
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

  const active = ACTIVITY_FILTERS.find((f) => f.key === filter)!;
  const rows = active.verbs
    ? project.activity.filter((r) =>
        (active.verbs as readonly string[]).includes(r.verb)
      )
    : project.activity;

  return (
    <div className="flex flex-col pb-6">
      <div className="flex items-baseline gap-2 pt-4 pb-3 px-4.5">
        <span className="font-bold text-[#121313] text-base/5 tracking-[-0.01em]">
          活动
        </span>
        <span className="text-[#777777] text-[10px]/3">{rows.length} 条</span>
      </div>

      <div className="flex items-center pb-3.5 gap-1.5 px-4.5">
        {ACTIVITY_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
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

      {groupByDay(collapseActivity(rows), t).map(([day, items]) => (
        <div key={day} className="flex flex-col">
          <div className="pt-3.5 pb-1.5 px-4.5">
            <span className="font-semibold text-[#999999] text-[10px]/3 tracking-[0.06em]">
              {day}
            </span>
          </div>
          {items.map(({ row, count }) => (
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

      {rows.length === 0 && (
        <div className="px-4.5 py-8 text-[#A5A5A5] text-[11px]/4">
          这个分类下还没有动静。
        </div>
      )}
    </div>
  );
}

/** 保持后端给的倒序，只在相邻同一天的行之间插分组标题。 */
function groupByDay(
  items: CollapsedActivity[],
  now: number
): [string, CollapsedActivity[]][] {
  const out: [string, CollapsedActivity[]][] = [];
  for (const item of items) {
    const day = dayLabel(item.row.at, now);
    const last = out[out.length - 1];
    if (last && last[0] === day) last[1].push(item);
    else out.push([day, [item]]);
  }
  return out;
}
