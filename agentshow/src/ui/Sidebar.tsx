import type { MeView } from "../api-types";
import { Avatar } from "./Avatar";
import {
  BotIcon,
  ChevronUpDownIcon,
  ComposeIcon,
  FolderIcon,
  Logo,
  PanelIcon
} from "./icons";

/**
 * 左栏：产品标记、两个入口、项目、agent、底部的人。
 *
 * agent 和项目并列成两个区，而不是把 agent 藏进项目里 ——
 * 一个 agent 会在多个项目里，它属于人，不属于某个项目。
 */
export function Sidebar({
  me,
  projectId,
  onPickProject
}: {
  me: MeView;
  projectId: string | null;
  onPickProject: (id: string) => void;
}) {
  return (
    <div className="w-60 shrink-0 flex flex-col bg-[#F3F3F3] h-full">
      <div className="h-10 shrink-0 flex items-center justify-between pr-4 pl-3.5">
        <div className="flex items-center gap-2">
          <div className="size-6 shrink-0 flex items-center justify-center rounded-md overflow-hidden bg-white border border-[#E4E4E4]">
            <Logo />
          </div>
          <div className="font-bold text-[#121313] text-[13px]/4 tracking-[-0.01em]">
            agentshow
          </div>
        </div>
        <PanelIcon />
      </div>

      <div className="flex flex-col mt-1.5 px-2.5 gap-px">
        <SidebarRow icon={<ComposeIcon />} label="新对话" />
        <SidebarRow icon={<BotIcon />} label="我的 Agent" />
      </div>

      <Section title="项目">
        {me.projects.map((p) => (
          <button
            key={p.projectId}
            type="button"
            onClick={() => onPickProject(p.projectId)}
            className={`h-7.5 shrink-0 flex items-center px-2 rounded-[5px] gap-2.25 w-full text-left ${
              p.projectId === projectId ? "bg-[#E7E7E7]" : "hover:bg-[#EAEAEA]"
            }`}
          >
            <FolderIcon color={p.projectId === projectId ? "#555555" : "#999999"} />
            <span
              className={`text-xs/4 truncate ${
                p.projectId === projectId
                  ? "font-semibold text-[#121313]"
                  : "font-medium text-[#4A4A4A]"
              }`}
            >
              {p.name}
            </span>
          </button>
        ))}
        {me.projects.length === 0 && <Empty>还没有项目</Empty>}
      </Section>

      <Section title="AGENT">
        {me.agents.map((a) => (
          <div
            key={a.memberId}
            className="h-8.5 shrink-0 flex items-center px-2 rounded-[5px] gap-2.25"
          >
            <Avatar member={a} size={20} />
            <span className="grow min-w-0 truncate font-medium text-[#121313] text-xs/4">
              {a.name}
            </span>
          </div>
        ))}
        {me.agents.length === 0 && <Empty>还没有 agent</Empty>}
      </Section>

      <div className="mt-auto shrink-0 pb-2.5 px-2.5">
        <div className="h-px mb-2 bg-[#E4E4E4] mx-2" />
        <div className="h-10 flex items-center px-2 rounded-md gap-2.25">
          <Avatar id={me.name} size={24} />
          <div className="grow min-w-0 flex flex-col gap-px">
            <div className="font-semibold text-[#121313] text-xs/4 truncate">
              {me.name}
            </div>
            <div className="text-[#777777] text-[10px]/3">
              {me.agents.length} 个 agent · {me.projects.length} 个项目
            </div>
          </div>
          <ChevronUpDownIcon />
        </div>
      </div>
    </div>
  );
}

function SidebarRow({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="h-7.5 shrink-0 flex items-center px-2 rounded-[5px] gap-2.25">
      {icon}
      <span className="font-medium text-[#121313] text-xs/4">{label}</span>
    </div>
  );
}

function Section({
  title,
  children
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col mt-5.5 px-2.5">
      <div className="h-6.5 shrink-0 flex items-center pl-2">
        <span className="font-semibold text-[#8A8A8A] text-[10px]/3 tracking-[0.06em]">
          {title}
        </span>
      </div>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-7.5 flex items-center px-2 text-[#A5A5A5] text-[11px]/4">
      {children}
    </div>
  );
}
