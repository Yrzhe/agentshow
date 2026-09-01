import { useState } from "react";
import type { ProjectView } from "../api-types";
import { ActivityTab } from "./ActivityTab";
import { AgentCard } from "./AgentCard";
import { FileDetail } from "./FileDetail";
import { FilesTab } from "./FilesTab";
import { MembersTab } from "./MembersTab";
import { OverviewTab } from "./OverviewTab";
import { HomeIcon, PlusIcon } from "./icons";

const TABS = ["概览", "文件", "活动", "成员"] as const;
type Tab = (typeof TABS)[number];

/**
 * 打开的详情。
 *
 * 详情不是第五个 tab，是压在某个 tab 上的一层 —— 文件详情属于「文件」，
 * 身份卡属于「成员」。tab 条上那个下划线因此不会在点进详情时消失，
 * 用户始终知道自己在哪一层里。
 */
export type Detail =
  | { kind: "file"; path: string }
  | { kind: "agent"; agentId: string }
  | null;

const TAB_OF: Record<"file" | "agent", Tab> = {
  file: "文件",
  agent: "成员"
};

/**
 * 一个文件「有没有被动过」的指纹，取自外层每 4 秒刷新的那份快照。
 * 文件详情盯着它，变了才重新取内容 —— 不用再开一条轮询。
 */
function stampOf(project: ProjectView, path: string): string {
  const f = project.files.find((x) => x.path === path);
  return f ? `${f.version}:${f.comments}` : "";
}

/**
 * 右栏：project 本身。
 *
 * 四个 tab 用的是同一次请求拿回来的数据，切 tab 不再发请求 ——
 * 它们是一批数据的四个切片，不是四个页面。详情各自去取自己的数据：
 * 文件内容和身份文档都可能很长，塞进那一次快照会让每次轮询都拖着它们。
 */
export function ProjectPanel({
  project,
  meId,
  detail,
  onDetail,
  onOpenProject,
  onReload
}: {
  project: ProjectView;
  meId: string;
  detail: Detail;
  onDetail: (d: Detail) => void;
  /** 身份卡里列着这个 agent 在的项目，点一个就切过去。 */
  onOpenProject: (projectId: string) => void;
  onReload: () => void;
}) {
  const [picked, setPicked] = useState<Tab>("概览");
  const tab = detail ? TAB_OF[detail.kind] : picked;

  // 一次渲染只取一个「现在」，否则同屏的相对时间会各算各的。
  const now = Date.now();

  function go(t: Tab) {
    setPicked(t);
    onDetail(null);
  }

  return (
    <div className="grow min-w-0 flex flex-col bg-white border-l border-[#E9E9E9] h-full">
      <div className="h-10 shrink-0 flex items-center px-4.5 gap-1.75">
        <button
          type="button"
          onClick={() => go("概览")}
          aria-label="回到概览"
          className="size-5.5 shrink-0 flex items-center justify-center rounded-[5px] bg-[#F0F0F0]"
        >
          <HomeIcon />
        </button>
        <div className="size-5.5 shrink-0 flex items-center justify-center rounded-[5px]">
          <PlusIcon />
        </div>
      </div>

      <div className="h-10 shrink-0 flex px-4.5 gap-5.5 border-b border-[#ECECEC]">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => go(t)}
            className={`flex items-center text-xs/4 ${
              t === tab
                ? "-mb-px border-b-[1.5px] border-[#121313] font-semibold text-[#121313]"
                : "font-medium text-[#777777] hover:text-[#4A4A4A]"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="grow min-h-0 overflow-y-auto">
        {detail?.kind === "file" ? (
          <FileDetail
            key={detail.path}
            projectId={project.projectId}
            path={detail.path}
            members={project.members}
            stamp={stampOf(project, detail.path)}
            onClose={() => onDetail(null)}
            onChanged={onReload}
          />
        ) : detail?.kind === "agent" ? (
          <AgentCard
            key={detail.agentId}
            agentId={detail.agentId}
            onClose={() => onDetail(null)}
            onOpenProject={onOpenProject}
          />
        ) : (
          <>
            {tab === "概览" && (
              <OverviewTab
                project={project}
                meId={meId}
                now={now}
                onOpenFile={(path) => onDetail({ kind: "file", path })}
                onOpenMember={(agentId) => onDetail({ kind: "agent", agentId })}
                onSeeAll={go}
              />
            )}
            {tab === "文件" && (
              <FilesTab
                project={project}
                now={now}
                onOpenFile={(path) => onDetail({ kind: "file", path })}
              />
            )}
            {tab === "活动" && <ActivityTab project={project} now={now} />}
            {tab === "成员" && (
              <MembersTab
                project={project}
                meId={meId}
                onOpenMember={(agentId) => onDetail({ kind: "agent", agentId })}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

export type { Tab };
