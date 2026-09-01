import { useState } from "react";
import type { MemberView, ProjectView } from "../api-types";
import { Avatar } from "./Avatar";
import { memberOf } from "./format";
import { ChevronDownIcon, SendIcon } from "./icons";

/**
 * 中栏：这个 project 里的会话，加一个发起新对话的输入框。
 *
 * 一个 (agent, project) 只有一条 session，所以这个列表等价于
 * 「这个项目里每个 agent 在干什么」。
 */
export function SessionList({
  project,
  agents,
  onOpen
}: {
  project: ProjectView;
  /** 可选的 agent —— 只能跟已经在这个 project 里的 agent 发起对话。 */
  agents: MemberView[];
  onOpen: (agentId: string, prompt?: string) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [target, setTarget] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const chosen = agents.find((a) => a.memberId === target) ?? agents[0];

  function send() {
    if (!chosen || !draft.trim()) return;
    onOpen(chosen.memberId, draft.trim());
    setDraft("");
  }

  return (
    <div className="w-130 shrink-0 flex flex-col bg-[#FCFCFC] border-l border-[#0000000F] h-full">
      <div className="h-10 shrink-0 flex items-center px-4.5">
        <div className="font-semibold text-[#121313] text-[15px]/4.5 truncate">
          {project.name}
        </div>
      </div>

      <div className="h-8 shrink-0 flex items-end pb-1 gap-1.75 px-4.5">
        <span className="font-semibold text-[#121313] text-xs/4">会话</span>
        <span className="text-[#777777] text-[10px]/3">
          {project.sessions.length}
        </span>
      </div>

      <div className="grow min-h-0 overflow-y-auto">
        {project.sessions.map((s) => {
          const who = memberOf(s.agentId, project.members);
          return (
            <button
              key={s.agentId}
              type="button"
              onClick={() => onOpen(s.agentId)}
              className="h-11 w-full shrink-0 flex items-center px-4.5 gap-2.25 border-b border-[#ECECEC] text-left hover:bg-[#F5F5F5]"
            >
              <Avatar member={who} id={s.agentId} size={20} />
              {/* 名字必须出现在文字里。标题是自动生成的，两个 agent 被同一件事
                  叫醒时会一字不差地重名 —— 那时只剩一枚 20px 的徽记区分它们，
                  而这一列存在的意义就是让人挑一个 agent 点进去。 */}
              <span className="shrink-0 font-medium text-[#121313] text-xs/4">
                {who?.name ?? s.agentId}
              </span>
              <span className="grow min-w-0 truncate text-[#777777] text-xs/4">
                {s.title}
              </span>
              <span
                className={`w-13 shrink-0 text-right text-[10px]/3 ${
                  s.status === "done"
                    ? "text-[#777777]"
                    : "font-medium text-[#2E9E6B]"
                }`}
              >
                {s.status === "done" ? "已完成" : "进行中"}
              </span>
            </button>
          );
        })}

        {project.sessions.length === 0 && (
          <div className="px-4.5 py-6 text-[#A5A5A5] text-[11px]/4">
            还没有会话。在下面挑一个 agent 说句话就开始了。
          </div>
        )}
      </div>

      <div className="shrink-0 pb-3.5 px-3.5 pt-2">
        <div className="flex flex-col justify-between p-3 rounded-[10px] bg-white border border-[#E9E9E9]">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={2}
            placeholder={
              chosen ? "在这个项目里发起对话" : "先把 agent 加进这个项目"
            }
            disabled={!chosen}
            className="resize-none outline-none text-[#121313] text-xs/4 placeholder:text-[#A5A5A5] bg-transparent"
          />
          <div className="flex items-center justify-between mt-3">
            <div className="relative">
              <button
                type="button"
                disabled={!chosen}
                onClick={() => setPickerOpen((v) => !v)}
                className="flex items-center gap-1.75 disabled:opacity-50"
              >
                {chosen && <Avatar member={chosen} size={18} />}
                <span className="font-medium text-[#4A4A4A] text-[11px]/3.5">
                  {chosen?.name ?? "无可用 agent"}
                </span>
                <ChevronDownIcon />
              </button>

              {pickerOpen && chosen && (
                <div className="absolute bottom-6 left-0 z-10 w-44 rounded-lg bg-white border border-[#E4E4E4] shadow-lg py-1">
                  {agents.map((a) => (
                    <button
                      key={a.memberId}
                      type="button"
                      onClick={() => {
                        setTarget(a.memberId);
                        setPickerOpen(false);
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-[#F3F3F3] text-left"
                    >
                      <Avatar member={a} size={18} />
                      <span className="font-medium text-[#121313] text-[11px]/3.5 truncate">
                        {a.name}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={send}
              disabled={!chosen || !draft.trim()}
              aria-label="发起会话"
              className="size-6 shrink-0 flex items-center justify-center rounded-xl bg-[#121313] disabled:opacity-30"
            >
              <SendIcon />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
