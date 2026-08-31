import { useEffect, useRef } from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/think/react";
import { agentKey } from "../agent-key";
import type { MemberView } from "../api-types";
import { Avatar } from "./Avatar";
import { ArrowLeftIcon, SendIcon } from "./icons";

/**
 * 一条 session 的对话。
 *
 * DO 实例名 `${agentId}:${projectId}` 就是这条 session 的地址 ——
 * 换 agent 或换 project 就是换一个实例，所以外层用 key 强制重挂载，
 * 不试图在同一个 hook 里换连接。
 */
export function Chat({
  agentId,
  projectId,
  owner,
  agent: profile,
  meName,
  firstPrompt,
  onBack
}: {
  agentId: string;
  projectId: string;
  /** Access 验过的邮箱，DO 实例名的前缀。 */
  owner: string;
  agent?: MemberView;
  meName: string;
  /** 从输入框直接开的会话，挂载后自动发一次。 */
  firstPrompt?: string;
  onBack: () => void;
}) {
  // 实例名带所有者前缀。服务端的 checkAgentRoute 会拿它跟 Access 验过的
  // 邮箱比对 —— 这里拼错只会被 403，拼不出别人的 session。
  const agent = useAgent({
    agent: "AgentDO",
    name: agentKey(owner, agentId, projectId)
  });
  const { messages, sendMessage, status } = useAgentChat({ agent });

  const sent = useRef(false);
  useEffect(() => {
    if (firstPrompt && !sent.current) {
      sent.current = true;
      sendMessage({ text: firstPrompt });
    }
  }, [firstPrompt, sendMessage]);

  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length, status]);

  return (
    <div className="w-130 shrink-0 flex flex-col bg-[#FCFCFC] border-l border-[#0000000F] h-full">
      <div className="h-10 shrink-0 flex items-center px-4.5 gap-2.25">
        <button type="button" onClick={onBack} className="shrink-0">
          <ArrowLeftIcon />
        </button>
        <Avatar member={profile} id={agentId} size={20} />
        <span className="font-semibold text-[#121313] text-[13px]/4 truncate">
          {profile?.name ?? agentId}
        </span>
        {status === "streaming" && (
          <span className="text-[#2E9E6B] text-[10px]/3 font-medium">思考中</span>
        )}
      </div>

      <div className="grow min-h-0 overflow-y-auto px-4.5 py-3 flex flex-col gap-4 border-t border-[#ECECEC]">
        {messages.map((m) => (
          <div key={m.id} className="flex gap-2.25">
            <div className="pt-0.5">
              {m.role === "user" ? (
                <Avatar id={meName} size={20} />
              ) : (
                <Avatar member={profile} id={agentId} size={20} />
              )}
            </div>
            <div className="grow min-w-0 flex flex-col gap-1">
              <span className="font-semibold text-[#121313] text-[11px]/3.5">
                {m.role === "user" ? "你" : (profile?.name ?? agentId)}
              </span>
              {m.parts.map((part, i) => (
                <Part key={i} part={part} />
              ))}
            </div>
          </div>
        ))}
        <div ref={bottom} />
      </div>

      <Composer onSend={(text) => sendMessage({ text })} />
    </div>
  );
}

/**
 * 工具调用也画出来。
 *
 * 演示里最有说服力的一段是「它写入被拒、读了新内容、重做」——
 * 只渲染文本的话，这一段在界面上完全看不见，用户只会看到它沉默了一会儿。
 */
function Part({ part }: { part: { type: string; text?: string } }) {
  if (part.type === "text") {
    return (
      <div className="text-[#121313] text-xs/5 whitespace-pre-wrap">
        {part.text}
      </div>
    );
  }

  if (part.type === "reasoning") {
    return (
      <div className="text-[#8A8A8A] text-[11px]/4 whitespace-pre-wrap">
        {part.text}
      </div>
    );
  }

  if (part.type.startsWith("tool-")) {
    return (
      <div className="flex items-center gap-1.5 text-[#6E6E6E] text-[10px]/3">
        <span className="text-[#B4B4B4]">→</span>
        <span className="font-mono">{part.type.slice("tool-".length)}</span>
      </div>
    );
  }

  return null;
}

function Composer({ onSend }: { onSend: (text: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);

  function send() {
    const text = ref.current?.value.trim();
    if (!text) return;
    onSend(text);
    if (ref.current) ref.current.value = "";
  }

  return (
    <div className="shrink-0 pb-3.5 px-3.5 pt-2">
      <div className="flex flex-col p-3 rounded-[10px] bg-white border border-[#E9E9E9]">
        <textarea
          ref={ref}
          rows={2}
          placeholder="继续说"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          className="resize-none outline-none text-[#121313] text-xs/4 placeholder:text-[#A5A5A5] bg-transparent"
        />
        <div className="flex justify-end mt-2">
          <button
            type="button"
            onClick={send}
            className="size-6 shrink-0 flex items-center justify-center rounded-xl bg-[#121313]"
          >
            <SendIcon />
          </button>
        </div>
      </div>
    </div>
  );
}
