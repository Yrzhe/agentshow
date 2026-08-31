import type { ActivityRow, FileView, MemberView } from "../api-types";
import { Avatar } from "./Avatar";
import {
  FILE_KIND_COLOR,
  FILE_KIND_LABEL,
  activityLine,
  fileKind,
  memberOf,
  relativeTime
} from "./format";
import { FileIcon } from "./icons";

/**
 * 概览和完整列表共用的行。
 *
 * 抽出来是因为两处的行必须长得一模一样 —— 各写一遍的话，改一处样式
 * 另一处就悄悄留在旧版本上，而它们在界面上只隔一次点击。
 */

export function SectionHeader({
  title,
  count,
  action,
  onAction
}: {
  title: string;
  count?: number | string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="h-8 shrink-0 flex items-end justify-between pt-1.5 pb-1 px-4.5">
      <div className="flex items-end gap-1.75">
        <span className="font-semibold text-[#121313] text-xs/4">{title}</span>
        {count !== undefined && (
          <span className="text-[#777777] text-[10px]/3">{count}</span>
        )}
      </div>
      {action && (
        <button
          type="button"
          onClick={onAction}
          className="font-medium text-[#777777] text-[10px]/3 hover:text-[#121313]"
        >
          {action}
        </button>
      )}
    </div>
  );
}

export function MemberRow({ m, isMe }: { m: MemberView; isMe: boolean }) {
  return (
    <div className="h-10 shrink-0 flex items-center px-4.5 gap-2.25">
      <Avatar member={m} size={22} />
      <span className="shrink-0 font-medium text-[#121313] text-xs/4">
        {m.name}
      </span>
      <span className="grow min-w-0 truncate text-[#777777] text-[10px]/3">
        {m.tagline ?? ""}
      </span>
      {/* 人和 agent 在同一张列表里，只靠右边这个标记区分。分成两块的话，
          界面就在说 agent 是另一类东西 —— 而这正是这个产品要否定的。 */}
      <span
        className={
          m.kind === "agent"
            ? "w-16 shrink-0 text-right font-semibold text-[#2E7D68] text-[9px]/3 tracking-[0.06em]"
            : "w-16 shrink-0 text-right text-[#777777] text-[10px]/3"
        }
      >
        {m.kind === "agent" ? "AGENT" : isMe ? "你" : ""}
      </span>
    </div>
  );
}

export function FileRow({
  f,
  members,
  now,
  onOpen,
  dense
}: {
  f: FileView;
  members: MemberView[];
  now: number;
  onOpen: () => void;
  /** 概览里只留 owner 头像和评论数，完整列表多两列。 */
  dense?: boolean;
}) {
  const kind = fileKind(f.path);
  const owner = memberOf(f.ownerId, members);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="h-11 w-full shrink-0 flex items-center px-4.5 gap-2.25 border-b border-[#ECECEC] text-left hover:bg-[#FAFBFC]"
    >
      <FileIcon kind={kind} color={FILE_KIND_COLOR[kind]} />
      <span className="grow min-w-0 truncate font-medium text-[#121313] text-xs/4">
        {f.path}
      </span>

      {dense ? (
        <span className="w-21.5 shrink-0 flex items-center gap-1.5">
          <Avatar member={owner} id={f.ownerId} size={16} />
          <span className="truncate font-medium text-[#555555] text-[10px]/3">
            {owner?.name ?? f.ownerId}
          </span>
        </span>
      ) : (
        <Avatar member={owner} id={f.ownerId} size={18} />
      )}

      <span
        className={`w-13 shrink-0 text-right text-[10px]/3 ${
          f.comments > 0 ? "font-semibold text-[#B4552E]" : "text-[#BDBDBD]"
        }`}
      >
        {f.comments > 0 ? `${f.comments} 条` : "无"}
      </span>

      {dense ? (
        <span className="w-18.5 shrink-0 text-right text-[#777777] text-[10px]/3">
          {FILE_KIND_LABEL[kind]} · v{f.version}
        </span>
      ) : (
        <span className="w-6.5 shrink-0 text-right text-[#777777] text-[10px]/3">
          v{f.version}
        </span>
      )}

      {dense && (
        <span className="w-17.5 shrink-0 text-right text-[#777777] text-[10px]/3">
          {relativeTime(f.updatedAt, now)}
        </span>
      )}
    </button>
  );
}

export function ActivityItem({
  row,
  count = 1,
  members,
  now,
  timeText
}: {
  row: ActivityRow;
  /** 折叠后这一行代表几条。 */
  count?: number;
  members: MemberView[];
  now: number;
  /** 完整流按天分组后显示时刻，概览里显示相对时间。 */
  timeText?: string;
}) {
  const line = activityLine(row, members, count);
  const actor = memberOf(row.actorId, members);
  const time = timeText ?? relativeTime(row.at, now);

  return (
    <div className="h-13 shrink-0 flex items-center px-4.5 gap-2.25">
      <Avatar member={actor} id={row.actorId} size={22} />
      <div className="grow min-w-0 flex flex-col gap-0.5">
        <span className="truncate font-medium text-[#121313] text-xs/4">
          {line.text}
        </span>
        <span className="truncate text-[#777777] text-[10px]/3">
          {line.detail ? `${line.detail} · ${time}` : time}
        </span>
      </div>
      <span
        className="w-11 h-4.5 shrink-0 flex items-center justify-center rounded-sm font-medium text-[9px]/3"
        style={{ background: line.badge.bg, color: line.badge.fg }}
      >
        {line.badge.label}
      </span>
    </div>
  );
}
