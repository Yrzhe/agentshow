import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FileDetailView, MemberView } from "../api-types";
import { Avatar } from "./Avatar";
import {
  FILE_KIND_COLOR,
  fileKind,
  memberOf,
  parseAnchor,
  relativeTime
} from "./format";
import { FileIcon, SendIcon } from "./icons";

/**
 * 一个文件：内容、归属、版本，和挂在它上面的讨论。
 *
 * 这一屏是「讨论挂在文件上，不挂在对话上」的落点 —— 五个 agent 各自跟人
 * 私聊，但它们对同一个文件的意见都堆在这里。
 */
export function FileDetail({
  projectId,
  path,
  members,
  stamp,
  onClose,
  onChanged
}: {
  projectId: string;
  path: string;
  members: MemberView[];
  /**
   * 这个文件在外层快照里的版本和评论数。
   *
   * 详情页自己不轮询 —— 外层已经每 4 秒拉一次 project，这个字符串一变就说明
   * 有 agent 动了这个文件，那时才重新取内容。没有它，agent 在你看着的时候把
   * 文件改了，而这一屏还停在旧版本上，恰好是「全程可见」失效的地方。
   */
  stamp: string;
  onClose: () => void;
  /** 留完评论或 @ 完人之后，让外层重新拉一次 project。 */
  onChanged: () => void;
}) {
  const [file, setFile] = useState<FileDetailView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const codeRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const url = `/api/projects/${projectId}/file?path=${encodeURIComponent(path)}`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url} → ${res.status}`);
      setFile((await res.json()) as FileDetailView);
    } catch (e) {
      setError(String(e));
    }
  }, [projectId, path]);

  // 换文件才清空重来；只是 stamp 变了就静默重取，不让内容闪一下。
  const shown = useRef("");
  useEffect(() => {
    if (shown.current !== path) {
      shown.current = path;
      setFile(null);
      setFocus(null);
    }
    load();
  }, [path, stamp, load]);

  // 点一条评论要能看见它说的是哪一行。只滚代码块自己 ——
  // 用 scrollIntoView 会把整个右栏也带着跑，讨论区就被推出视野了。
  useEffect(() => {
    const box = codeRef.current;
    const hit = parseAnchor(focus);
    if (!box || !hit) return;
    const line = box.querySelector<HTMLElement>(`[data-line="${hit.from}"]`);
    if (line) box.scrollTop = line.offsetTop - box.clientHeight / 2;
  }, [focus]);

  const lines = useMemo(() => (file ? file.content.split("\n") : []), [file]);
  const highlight = parseAnchor(focus);
  const owner = file ? memberOf(file.ownerId, members) : undefined;
  const agents = members.filter((m) => m.kind === "agent");
  const now = Date.now();

  if (error) return <Pad>{error}</Pad>;
  if (!file) return <Pad>正在读文件</Pad>;

  return (
    <div className="flex flex-col pb-6">
      <div className="flex items-center pt-3.5 gap-1.5 px-4.5">
        <button
          type="button"
          onClick={onClose}
          className="text-[#999999] text-[10px]/3 hover:text-[#121313]"
        >
          文件
        </button>
        <span className="text-[#C4C4C4] text-[10px]/3">/</span>
        <button
          type="button"
          onClick={onClose}
          className="font-medium text-[#777777] text-[10px]/3 hover:text-[#121313]"
        >
          共享区
        </button>
        <span className="text-[#C4C4C4] text-[10px]/3">/</span>
        <span className="font-medium text-[#777777] text-[10px]/3 truncate">
          {file.path}
        </span>
      </div>

      <div className="flex items-start gap-2.5 pt-1 pb-3 px-4.5">
        <div className="pt-1">
          <FileIcon
            kind={fileKind(file.path)}
            color={FILE_KIND_COLOR[fileKind(file.path)]}
            size={20}
          />
        </div>
        <div className="min-w-0">
          <div className="font-bold text-[#121313] text-base/5 tracking-[-0.01em] truncate">
            {file.path}
          </div>
          <div className="flex items-center gap-1.5 mt-1">
            <Avatar member={owner} id={file.ownerId} size={14} />
            <span className="text-[#777777] text-[10px]/3">
              {owner?.name ?? file.ownerId} 拥有 · v{file.version} ·{" "}
              {relativeTime(file.updatedAt, now)}
            </span>
          </div>
        </div>
      </div>

      <div className="px-4.5">
        {/* 高度封顶：不封的话一个几百行的文件会把讨论整个顶到折叠线以下，
            而讨论才是这一屏存在的理由。 */}
        <div
          ref={codeRef}
          className="rounded-lg border border-[#ECECEC] bg-[#FCFCFC] overflow-auto max-h-72 py-2"
        >
          {lines.map((line, i) => {
            const n = i + 1;
            const hit = highlight && n >= highlight.from && n <= highlight.to;
            return (
              <button
                key={n}
                data-line={n}
                type="button"
                // 点一行就把它填进输入框的 anchor —— agent 用「第 42 行」定位，
                // 人也该能用同一种方式，否则锚点是个只读的东西。
                onClick={() => setFocus(`第 ${n} 行`)}
                className={`w-full flex gap-3 px-3 text-left font-mono text-[11px]/4.5 ${
                  hit ? "bg-[#FDF3EF]" : "hover:bg-[#F5F5F5]"
                }`}
              >
                <span className="w-7 shrink-0 text-right text-[#B4B4B4] select-none">
                  {n}
                </span>
                <span className="whitespace-pre text-[#3A3A3A]">{line}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-end gap-1.75 pt-5 pb-1 px-4.5">
        <span className="font-semibold text-[#121313] text-xs/4">讨论</span>
        <span className="text-[#777777] text-[10px]/3">
          {file.comments.length} 条 · 挂在这个文件上
        </span>
      </div>

      {file.comments.map((c) => {
        const who = memberOf(c.authorId, members);
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => setFocus(c.anchor)}
            className="flex items-start gap-2.25 px-4.5 py-2.5 text-left hover:bg-[#FAFBFC]"
          >
            <div className="pt-0.5">
              <Avatar member={who} id={c.authorId} size={22} />
            </div>
            <div className="grow min-w-0">
              <div className="flex items-center gap-1.75">
                <span className="font-semibold text-[#121313] text-[11px]/3.5">
                  {who?.name ?? c.authorId}
                </span>
                {who?.kind === "agent" && (
                  <span className="font-semibold text-[#2E7D68] text-[9px]/3 tracking-[0.06em]">
                    AGENT
                  </span>
                )}
                <span className="text-[#999999] text-[10px]/3">
                  {relativeTime(c.createdAt, now)}
                  {c.anchor ? ` · ${c.anchor}` : ""}
                  {/* 评论针对的版本。文件改过之后，看的人要能分清
                      这是针对当前这一版，还是老版本的遗留。 */}
                  {c.fileVersion !== file.version ? ` · 针对 v${c.fileVersion}` : ""}
                </span>
              </div>
              <div className="mt-1 text-[#3A3A3A] text-xs/5 whitespace-pre-wrap">
                {c.text}
              </div>
            </div>
          </button>
        );
      })}

      {file.comments.length === 0 && (
        <div className="px-4.5 py-3 text-[#A5A5A5] text-[11px]/4">
          还没有人说什么。
        </div>
      )}

      <Composer
        projectId={projectId}
        path={file.path}
        anchor={focus}
        agents={agents}
        onClearAnchor={() => setFocus(null)}
        onDone={() => {
          setFocus(null);
          // 两处都要刷：这一屏的讨论，和右栏其余部分的活动流。
          load();
          onChanged();
        }}
      />
    </div>
  );
}

/**
 * 留评论，或者把活交给一个 agent。
 *
 * 两件事共用一个输入框：选了 @ 谁就是提及，没选就是评论。
 * 分成两个框会让「说点什么」和「让谁去做」看起来像两件不相干的事，
 * 而在这个产品里它们是同一个动作的两种收尾。
 */
function Composer({
  projectId,
  path,
  anchor,
  agents,
  onClearAnchor,
  onDone
}: {
  projectId: string;
  path: string;
  anchor: string | null;
  agents: MemberView[];
  onClearAnchor: () => void;
  onDone: () => void;
}) {
  const [text, setText] = useState("");
  const [to, setTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  async function submit() {
    if (!text.trim() || busy) return;
    setBusy(true);
    setFailed(null);

    const target = agents.find((a) => a.memberId === to);
    const res = await fetch(
      `/api/projects/${projectId}/${target ? "mentions" : "comments"}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          target
            ? { toAgentName: target.name, path, message: text.trim() }
            : { path, text: text.trim(), anchor: anchor ?? undefined }
        )
      }
    ).catch(() => null);

    setBusy(false);
    if (!res?.ok) {
      // 静默失败在这里最伤：用户以为已经把活派出去了，而那个 agent 从没醒过。
      setFailed(target ? `没能叫醒 ${target.name}` : "没能留下这条评论");
      return;
    }
    setText("");
    setTo(null);
    onDone();
  }

  return (
    <div className="px-4.5 pt-3">
      <div className="rounded-[10px] border border-[#E9E9E9] bg-white p-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          placeholder="写点什么，或者 @ 一个 agent 让它接手"
          className="w-full resize-none outline-none text-[#121313] text-xs/4 placeholder:text-[#A5A5A5] bg-transparent"
        />

        <div className="flex items-center justify-between mt-2 gap-2">
          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
            {agents.map((a) => (
              <button
                key={a.memberId}
                type="button"
                onClick={() => setTo(to === a.memberId ? null : a.memberId)}
                className={`h-6 flex items-center gap-1 px-2 rounded-md text-[10px]/3 font-medium ${
                  to === a.memberId
                    ? "bg-[#121313] text-white"
                    : "border border-[#E4E4E4] text-[#555555] hover:bg-[#F5F5F5]"
                }`}
              >
                <span className={to === a.memberId ? "opacity-70" : "text-[#999999]"}>
                  @
                </span>
                {a.name}
              </button>
            ))}

            {anchor && !to && (
              <button
                type="button"
                onClick={onClearAnchor}
                title="不针对这一处"
                className="h-6 flex items-center gap-1 px-2 rounded-md border border-[#E4E4E4] text-[#8A6A4A] bg-[#F4EFE9] text-[10px]/3 font-medium"
              >
                {anchor} ×
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={submit}
            disabled={!text.trim() || busy}
            className="size-6 shrink-0 flex items-center justify-center rounded-xl bg-[#121313] disabled:opacity-30"
          >
            <SendIcon />
          </button>
        </div>

        {failed && (
          <div className="mt-2 text-[#B4552E] text-[10px]/3">{failed}</div>
        )}
      </div>

      {to && (
        <div className="pt-1.5 text-[#777777] text-[10px]/3">
          这会叫醒它，它会自己读 {path} 再决定怎么做。
        </div>
      )}
    </div>
  );
}

function Pad({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4.5 py-8 text-[#8A8A8A] text-[11px]/4">{children}</div>
  );
}
