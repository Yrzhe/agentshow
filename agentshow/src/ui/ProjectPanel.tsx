import { useState } from "react";
import type { ProjectView } from "../api-types";
import { ActivityTab } from "./ActivityTab";
import { FilesTab } from "./FilesTab";
import { MembersTab } from "./MembersTab";
import { OverviewTab } from "./OverviewTab";
import { HomeIcon, PlusIcon } from "./icons";

const TABS = ["概览", "文件", "活动", "成员"] as const;
type Tab = (typeof TABS)[number];

/**
 * 右栏：project 本身。
 *
 * 四个 tab 用的是同一次请求拿回来的数据，切 tab 不再发请求 ——
 * 它们是一批数据的四个切片，不是四个页面。
 */
export function ProjectPanel({
  project,
  meId,
  onOpenFile
}: {
  project: ProjectView;
  meId: string;
  onOpenFile: (path: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("概览");

  // 一次渲染只取一个「现在」，否则同屏的相对时间会各算各的。
  const now = Date.now();

  return (
    <div className="grow min-w-0 flex flex-col bg-white border-l border-[#E9E9E9] h-full">
      <div className="h-10 shrink-0 flex items-center px-4.5 gap-1.75">
        <div className="size-5.5 shrink-0 flex items-center justify-center rounded-[5px] bg-[#F0F0F0]">
          <HomeIcon />
        </div>
        <div className="size-5.5 shrink-0 flex items-center justify-center rounded-[5px]">
          <PlusIcon />
        </div>
      </div>

      <div className="h-10 shrink-0 flex px-4.5 gap-5.5 border-b border-[#ECECEC]">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
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
        {tab === "概览" && (
          <OverviewTab
            project={project}
            meId={meId}
            now={now}
            onOpenFile={onOpenFile}
            onSeeAll={setTab}
          />
        )}
        {tab === "文件" && (
          <FilesTab project={project} now={now} onOpenFile={onOpenFile} />
        )}
        {tab === "活动" && <ActivityTab project={project} now={now} />}
        {tab === "成员" && <MembersTab project={project} meId={meId} />}
      </div>
    </div>
  );
}

export type { Tab };
