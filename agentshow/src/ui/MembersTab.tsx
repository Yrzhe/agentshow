import type { ProjectView } from "../api-types";
import { MemberRow } from "./rows";

/**
 * 成员的完整列表。人和 agent 一张表，按加入顺序。
 */
export function MembersTab({
  project,
  meId,
  onOpenMember
}: {
  project: ProjectView;
  meId?: string;
  onOpenMember: (agentId: string) => void;
}) {
  const agents = project.members.filter((m) => m.kind === "agent").length;

  return (
    <div className="flex flex-col pb-6">
      <div className="flex items-baseline gap-2 pt-4 pb-3 px-4.5">
        <span className="font-bold text-[#121313] text-base/5 tracking-[-0.01em]">
          成员
        </span>
        <span className="text-[#777777] text-[10px]/3">
          {project.members.length} 人 · 其中 {agents} 个 agent
        </span>
      </div>

      {project.members.map((m) => (
        <MemberRow
          key={m.memberId}
          m={m}
          isMe={m.memberId === meId}
          onOpen={onOpenMember}
        />
      ))}
    </div>
  );
}
