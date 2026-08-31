import type { ProjectView } from "../api-types";
import { FileRow } from "./rows";

/**
 * 文件的完整列表。
 *
 * 归属那一列是这一屏的重点：文件的 owner 是创建它的那个成员，
 * 而这里大多数行的头像会是 agent。别人改它不夺走归属 ——
 * 这一列回答「这是谁的东西」，不是「谁最后碰过」。
 */
export function FilesTab({
  project,
  now,
  onOpenFile
}: {
  project: ProjectView;
  now?: number;
  onOpenFile: (path: string) => void;
}) {
  const t = now ?? Date.now();

  return (
    <div className="flex flex-col pb-6">
      <div className="flex items-center pt-3.5 gap-1.5 px-4.5">
        <span className="text-[#999999] text-[10px]/3">文件</span>
        <span className="text-[#C4C4C4] text-[10px]/3">/</span>
        <span className="font-medium text-[#777777] text-[10px]/3">共享区</span>
      </div>

      <div className="flex items-baseline gap-2 pt-1 pb-3 px-4.5">
        <span className="font-bold text-[#121313] text-base/5 tracking-[-0.01em]">
          共享区
        </span>
        <span className="text-[#777777] text-[10px]/3">
          {project.files.length} 项
        </span>
      </div>

      <div className="flex items-center h-7 shrink-0 px-4.5 gap-2.25 border-b border-[#E4E4E4]">
        <span className="w-3.75 shrink-0" />
        <span className="grow min-w-0 font-semibold text-[#999999] text-[9px]/3 tracking-[0.08em]">
          名称
        </span>
        <span className="w-21.5 shrink-0 font-semibold text-[#999999] text-[9px]/3 tracking-[0.08em]">
          归属
        </span>
        <span className="w-13 shrink-0 text-right font-semibold text-[#999999] text-[9px]/3 tracking-[0.08em]">
          评论
        </span>
        <span className="w-18.5 shrink-0 text-right font-semibold text-[#999999] text-[9px]/3 tracking-[0.08em]">
          类型
        </span>
        <span className="w-17.5 shrink-0 text-right font-semibold text-[#999999] text-[9px]/3 tracking-[0.08em]">
          更新
        </span>
      </div>

      {project.files.map((f) => (
        <FileRow
          key={f.path}
          f={f}
          members={project.members}
          now={t}
          dense
          onOpen={() => onOpenFile(f.path)}
        />
      ))}

      {project.files.length === 0 && (
        <div className="px-4.5 py-8 text-[#A5A5A5] text-[11px]/4">
          共享区还是空的。让一个 agent 往里写点东西。
        </div>
      )}
    </div>
  );
}
