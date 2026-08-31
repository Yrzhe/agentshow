import type { ProjectView } from "../api-types";
import { collapseActivity } from "./format";
import type { Tab } from "./ProjectPanel";
import { ActivityItem, FileRow, MemberRow, SectionHeader } from "./rows";

/**
 * 概览：这个项目里有谁、有什么、刚发生了什么。
 *
 * 成员放最上面 —— 人和 agent 混在一张列表里，是这个产品最先要说的那句话。
 */
export function OverviewTab({
  project,
  meId,
  now,
  onOpenFile,
  onOpenMember,
  onSeeAll
}: {
  project: ProjectView;
  meId?: string;
  now?: number;
  onOpenFile: (path: string) => void;
  onOpenMember: (agentId: string) => void;
  onSeeAll: (tab: Tab) => void;
}) {
  const t = now ?? Date.now();

  return (
    <div className="flex flex-col pb-6">
      <SectionHeader
        title="成员"
        count={project.members.length}
        action="管理"
        onAction={() => onSeeAll("成员")}
      />
      {project.members.map((m) => (
        <MemberRow
          key={m.memberId}
          m={m}
          isMe={m.memberId === meId}
          onOpen={onOpenMember}
        />
      ))}

      <div className="mt-3.5" />
      <SectionHeader
        title="共享文件"
        action="查看全部"
        onAction={() => onSeeAll("文件")}
      />
      {project.files.slice(0, 3).map((f) => (
        <FileRow
          key={f.path}
          f={f}
          members={project.members}
          now={t}
          onOpen={() => onOpenFile(f.path)}
        />
      ))}
      {project.files.length === 0 && <Empty>还没有共享文件</Empty>}

      <div className="mt-3.5" />
      <SectionHeader
        title="活动"
        action="查看全部"
        onAction={() => onSeeAll("活动")}
      />
      {/* 先折叠再取前四条 —— 反过来的话，一次复审的五条评论会把
          概览里其余的事件全挤掉。 */}
      {collapseActivity(project.activity)
        .slice(0, 4)
        .map(({ row, count }) => (
          <ActivityItem
            key={row.id}
            row={row}
            count={count}
            members={project.members}
            now={t}
          />
        ))}
      {project.activity.length === 0 && <Empty>还没有动静</Empty>}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4.5 py-4 text-[#A5A5A5] text-[11px]/4">{children}</div>
  );
}
