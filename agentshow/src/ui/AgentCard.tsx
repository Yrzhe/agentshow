import { useEffect, useState } from "react";
import type { AgentCardView } from "../api-types";
import { Avatar } from "./Avatar";
import { FolderIcon } from "./icons";

/**
 * agent 的身份卡。
 *
 * 这一屏要回答的是「这个东西是谁」，而不是「它做过什么」—— 做过什么在
 * 活动流里。所以主体是身份文档本身：那段文字是它人格的唯一来源，
 * 每个 project 里的每条 session 读的都是这一份。
 */
export function AgentCard({
  agentId,
  onClose,
  onOpenProject
}: {
  agentId: string;
  onClose: () => void;
  onOpenProject: (projectId: string) => void;
}) {
  const [card, setCard] = useState<AgentCardView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCard(null);
    (async () => {
      try {
        const res = await fetch(`/api/agents/${agentId}`);
        if (!res.ok) throw new Error(`身份卡读不到（${res.status}）`);
        setCard((await res.json()) as AgentCardView);
      } catch (e) {
        setError(String(e));
      }
    })();
  }, [agentId]);

  if (error) return <Pad>{error}</Pad>;
  if (!card) return <Pad>正在读身份卡</Pad>;

  return (
    <div className="flex flex-col pb-8">
      <div className="flex items-center pt-3.5 gap-1.5 px-4.5">
        <button
          type="button"
          onClick={onClose}
          className="text-[#999999] text-[10px]/3 hover:text-[#121313]"
        >
          成员
        </button>
        <span className="text-[#C4C4C4] text-[10px]/3">/</span>
        <span className="font-medium text-[#777777] text-[10px]/3">
          {card.name}
        </span>
      </div>

      <div className="flex items-start gap-3 pt-2 pb-4 px-4.5">
        <Avatar member={{ ...card, memberId: card.agentId, kind: "agent" }} size={44} />
        <div className="min-w-0 pt-0.5">
          <div className="flex items-center gap-2">
            <span className="font-bold text-[#121313] text-lg/6 tracking-[-0.01em]">
              {card.name}
            </span>
            <span className="font-semibold text-[#2E7D68] text-[9px]/3 tracking-[0.06em]">
              Agent
            </span>
          </div>
          {card.tagline && (
            <div className="mt-1 text-[#777777] text-[11px]/4">{card.tagline}</div>
          )}
        </div>
      </div>

      {card.description && (
        <>
          <Header>简介</Header>
          <div className="px-4.5 text-[#3A3A3A] text-xs/5 whitespace-pre-wrap">
            {card.description}
          </div>
        </>
      )}

      {card.capabilities && card.capabilities.length > 0 && (
        <>
          <Header>能力</Header>
          <div className="flex flex-wrap gap-1.5 px-4.5">
            {card.capabilities.map((c) => (
              <span
                key={c}
                className="h-6 flex items-center px-2.5 rounded-md border border-[#E4E4E4] text-[#555555] text-[10px]/3 font-medium"
              >
                {c}
              </span>
            ))}
          </div>
        </>
      )}

      {/* 身份文档是这一屏的主体。它是 soul —— 每条 session 的 system prompt
          都从这里来，所以看懂它就等于看懂这个 agent 会怎么做事。 */}
      <Header>身份文档</Header>
      <div className="px-4.5">
        <div className="rounded-lg border border-[#ECECEC] bg-[#FCFCFC] p-3 text-[#3A3A3A] text-[11px]/5 whitespace-pre-wrap font-mono">
          {card.identityDoc}
        </div>
      </div>

      {/* 这一段是「身份跨 project」在界面上唯一的证据：同一个 agent 出现在
          几个项目里，而上面那份人格和它的记忆只有一份。 */}
      <Header>它在这些项目里</Header>
      {card.projects.map((p) => (
        <button
          key={p.projectId}
          type="button"
          onClick={() => onOpenProject(p.projectId)}
          className="h-10 w-full flex items-center px-4.5 gap-2.25 border-b border-[#ECECEC] text-left hover:bg-[#FAFBFC]"
        >
          <FolderIcon color="#8A8A8A" />
          <span className="grow min-w-0 truncate font-medium text-[#121313] text-xs/4">
            {p.name}
          </span>
        </button>
      ))}
      {card.projects.length === 0 && (
        <div className="px-4.5 text-[#A5A5A5] text-[11px]/4">
          还没被拉进任何项目。
        </div>
      )}
    </div>
  );
}

function Header({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-end pt-5 pb-1.5 px-4.5">
      <span className="font-semibold text-[#121313] text-xs/4">{children}</span>
    </div>
  );
}

function Pad({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4.5 py-8 text-[#8A8A8A] text-[11px]/4">{children}</div>
  );
}
