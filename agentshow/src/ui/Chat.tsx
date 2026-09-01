import { useCallback, useEffect, useRef, useState } from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/think/react";
import { agentKey } from "../agent-key";
import type { MemberView } from "../api-types";
import { parseInline, toolLabel } from "./format";
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
  const {
    messages,
    sendMessage,
    status,
    error,
    clearError,
    regenerate,
    connectionError
  } = useAgentChat({ agent });

  const sent = useRef(false);
  useEffect(() => {
    if (firstPrompt && !sent.current) {
      sent.current = true;
      sendMessage({ text: firstPrompt });
    }
  }, [firstPrompt, sendMessage]);

  /**
   * 发之前先把上一轮的错误清掉，否则横幅会一直挂在那儿。
   *
   * 断线时 socket 自己会一直重连（partysocket 的默认值就是无限重试、
   * 3–10 秒退避，见 partysocket/dist/ws.js 的 DEFAULT），所以这里不做重连；
   * 连接没恢复之前输入框是锁的，话不会掉进虚空。
   */
  const send = useCallback(
    async (text: string) => {
      clearError();
      await sendMessage({ text });
    },
    [clearError, sendMessage]
  );

  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length, status]);

  return (
    <div className="w-130 shrink-0 flex flex-col bg-[#FCFCFC] border-l border-[#0000000F] h-full">
      <div className="h-10 shrink-0 flex items-center px-4.5 gap-2.25">
        <button
          type="button"
          onClick={onBack}
          aria-label="返回会话列表"
          className="shrink-0"
        >
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

      {connectionError ? (
        <Banner text="和这条会话的连接断了，正在重连。这期间发不出去。" />
      ) : error ? (
        <Banner
          text={`${profile?.name ?? agentId} 这一轮没能回复。`}
          action={{ label: "重试", onClick: () => regenerate() }}
        />
      ) : null}

      <Composer onSend={send} blocked={Boolean(connectionError)} />
    </div>
  );
}

/**
 * 失败要说出来。
 *
 * 不说的话，断线和「它还在想」在界面上长得一模一样 —— 用户会继续打字，
 * 而每一句都掉进虚空。
 */
function Banner({
  text,
  action
}: {
  text: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div
      role="status"
      className="shrink-0 mx-3.5 mb-1 px-2.5 py-1.5 rounded-lg bg-[#FBF0EC] flex items-center gap-2"
    >
      <span className="grow text-[#9A5B44] text-[11px]/4">{text}</span>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="shrink-0 text-[#9A5B44] text-[11px]/4 font-semibold underline underline-offset-2"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

/**
 * 工具调用也画出来。
 *
 * 演示里最有说服力的一段是「它写入被拒、读了新内容、重做」——
 * 只渲染文本的话，这一段在界面上完全看不见，用户只会看到它沉默了一会儿。
 *
 * 画出来不等于原样倒出来。这一屏赌的是「agent 是同事」，而同事不会
 * 当着你的面用英文自言自语、再报一遍自己要调哪个函数。所以思维链默认
 * 收起来、工具名过中文表、正文认行内 markdown。
 */
function Part({ part }: { part: { type: string; text?: string } }) {
  if (part.type === "text") {
    return <Prose text={part.text ?? ""} />;
  }

  if (part.type === "reasoning") {
    return <Reasoning text={part.text ?? ""} />;
  }

  if (part.type.startsWith("tool-")) {
    return (
      <div className="flex items-center gap-1.5 text-[#6E6E6E] text-[10px]/3">
        <span className="text-[#B4B4B4]" aria-hidden="true">
          →
        </span>
        <span>{toolLabel(part.type.slice("tool-".length))}</span>
      </div>
    );
  }

  return null;
}

/** 正文。段落照旧靠换行，行内认反引号和 `**`。 */
function Prose({ text }: { text: string }) {
  return (
    <div className="text-[#121313] text-xs/5 whitespace-pre-wrap">
      {parseInline(text).map((span, i) => {
        if (span.kind === "code") {
          return (
            <code
              key={i}
              className="px-1 py-px rounded bg-[#F1F1F1] text-[#3A3A3A] text-[11px]"
            >
              {span.value}
            </code>
          );
        }
        if (span.kind === "strong") {
          return (
            <strong key={i} className="font-semibold">
              {span.value}
            </strong>
          );
        }
        return <span key={i}>{span.value}</span>;
      })}
    </div>
  );
}

/**
 * 思维链默认收起。
 *
 * 它对调试有用、对看演示的人没用 —— 一段英文自言自语挂在中文名字底下，
 * 读起来就是这个「同事」说的话。想看的人点开，抬头用中文说清那是什么。
 */
function Reasoning({ text }: { text: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="self-start text-[#A5A5A5] text-[10px]/3"
      >
        {open ? "收起思考过程" : "看它是怎么想的"}
      </button>
      {open && (
        <div className="text-[#8A8A8A] text-[11px]/4 whitespace-pre-wrap border-l-2 border-[#ECECEC] pl-2">
          {text}
        </div>
      )}
    </div>
  );
}

/**
 * 输入框是受控的，为的是**发送失败时字还在**。
 *
 * 之前是发完无条件清空：断线的时候用户打的那句被清掉、消息没发出去、
 * 屏幕上什么痕迹都没有 —— 三件事叠在一起，看上去就像他从没打过字。
 */
function Composer({
  onSend,
  blocked
}: {
  onSend: (text: string) => Promise<void>;
  blocked: boolean;
}) {
  const [draft, setDraft] = useState("");
  const text = draft.trim();
  const canSend = text.length > 0 && !blocked;

  function send() {
    if (!canSend) return;
    // 立刻清空：sendMessage 要等整轮回复流完才 resolve，等它就等于
    // 在 agent 说话的整段时间里把输入框锁着。
    setDraft("");
    // 真被拒了就把字还回去 —— 但只在用户还没开始打下一句的时候。
    onSend(text).catch(() => setDraft((d) => (d.length > 0 ? d : text)));
  }

  return (
    <div className="shrink-0 pb-3.5 px-3.5 pt-2">
      <div className="flex flex-col p-3 rounded-[10px] bg-white border border-[#E9E9E9]">
        <textarea
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={blocked ? "等连接恢复" : "继续说"}
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
            disabled={!canSend}
            aria-label="发送"
            className="size-6 shrink-0 flex items-center justify-center rounded-xl bg-[#121313] disabled:bg-[#C8C8C8]"
          >
            <SendIcon />
          </button>
        </div>
      </div>
    </div>
  );
}
