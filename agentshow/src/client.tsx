import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { MeView, ProjectView } from "./api-types";
import { Chat } from "./ui/Chat";
import { type Detail, ProjectPanel, type Tab } from "./ui/ProjectPanel";
import { SessionList } from "./ui/SessionList";
import { Sidebar } from "./ui/Sidebar";
import { type AppLocation, readLocation, toSearch } from "./ui/url-state";
import "./styles.css";

/**
 * 三栏：人的东西 / 会话 / project 本身。
 *
 * 中栏和右栏都属于当前选中的 project。整个应用的位置只有四件事：
 * 选了哪个 project、开着哪条 session、右栏在哪个 tab、压着哪层详情 ——
 * 这四件都住在地址栏里，刷新和分享都不丢（见 ui/url-state.ts）。
 */

async function api<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return (await res.json()) as T;
}

function App() {
  const [me, setMe] = useState<MeView | null>(null);
  const [project, setProject] = useState<ProjectView | null>(null);
  const [loc, setLoc] = useState<AppLocation>(() =>
    readLocation(window.location.search)
  );
  /**
   * 从输入框直接开新会话时带的第一句话。
   *
   * 不进地址栏：它是一次性的动作，不是位置。进去的话，刷新会让这句话
   * 再发一遍，把同一条 session 里的第一句变成两句。
   */
  const [prompt, setPrompt] = useState<string | undefined>(undefined);
  /** 起不来才算致命。只有首次 /api/me 失败会置上它。 */
  const [fatal, setFatal] = useState<string | null>(null);
  /** 轮询暂时失败。界面照常可用，只在角落挂一条。 */
  const [stale, setStale] = useState<string | null>(null);

  const projectId = loc.projectId;

  // 前进后退。浏览器改了地址栏，界面跟着走 —— 没有它，返回键会一路
  // 退出这个应用，而用户以为它只是关掉一层详情。
  const locRef = useRef(loc);
  locRef.current = loc;
  useEffect(() => {
    const onPop = () => setLoc(readLocation(window.location.search));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const go = useCallback((next: Partial<AppLocation>, replace = false) => {
    const merged = { ...locRef.current, ...next };
    const search = toSearch(merged);
    if (search !== window.location.search) {
      const url = `${window.location.pathname}${search}`;
      if (replace) window.history.replaceState(null, "", url);
      else window.history.pushState(null, "", url);
    }
    setLoc(merged);
  }, []);

  // 当前选中的 project，给异步回调看的。用 ref 不用 state：
  // 回调要的是「响应落地那一刻的选中值」，不是它被创建时闭包捕获的那个。
  const currentProject = useRef<string | null>(null);
  currentProject.current = projectId;

  useEffect(() => {
    api<MeView>("/api/me")
      .then((m) => {
        setMe(m);
        // 地址栏没指定就落到第一个项目，并且把它写回地址栏 ——
        // replace 不 push：这是个默认值，不是用户做过的一次跳转。
        if (!locRef.current.projectId) {
          const first = m.projects[0]?.projectId ?? null;
          if (first) go({ projectId: first }, true);
        }
      })
      // 只有这一次失败是致命的：没有它连左栏都画不出来。
      .catch(() => setFatal("连不上服务器。刷新页面再试一次。"));
  }, [go]);

  /**
   * 轮询失败不接管界面。
   *
   * 之前是 `.catch(e => setError(String(e)))` 加一句 `if (error) return <Center>`，
   * 而全文件没有一次把 error 清回 null —— 于是 4 秒一次的轮询里任何一次抖动
   * （agent 正在推理、DO 冷启、Wi-Fi 掉一拍）都会把左中右三栏永久换成一行
   * `Error: /api/projects/pricing → 500`，之后再多成功的轮询也救不回来。
   *
   * 现在：成功就清掉提示，失败只在角落挂一条，界面照常可用。
   */
  const reload = useCallback(() => {
    if (!projectId) return;

    // 记下这次请求是为哪个 project 发的。迟到的响应不许覆盖已经切走的界面 ——
    // 否则用户会在 B 项目里看到 A 项目的文件，点进去留的评论也落进 A。
    const forProject = projectId;

    api<ProjectView>(`/api/projects/${forProject}`)
      .then((p) => {
        if (currentProject.current !== forProject) return;
        setProject(p);
        setStale(null);
      })
      .catch(() => {
        if (currentProject.current !== forProject) return;
        setStale("连接不稳定，正在重试");
      });
  }, [projectId]);

  // 换 project 就丢掉上一个的快照。位置本身由地址栏管，这里只管数据。
  useEffect(() => {
    setProject(null);
    reload();
  }, [reload]);

  /**
   * agent 干活是异步的：它写文件、留评论、@别人，都发生在推理过程中，
   * 而右栏是一次性的快照。轮询让那些动作在几秒内出现在活动流里 ——
   * 不轮询的话，演示时要手动刷新才看得见 agent 做了什么。
   */
  useEffect(() => {
    if (!projectId) return;
    const timer = setInterval(reload, 4000);
    return () => clearInterval(timer);
  }, [projectId, reload]);

  if (fatal) return <Center>{fatal}</Center>;
  if (!me) return <Center>正在加载</Center>;

  const projectAgents =
    project?.members.filter((m) => m.kind === "agent") ?? [];

  return (
    <div className="flex h-full bg-[#F5F5F5] text-xs/4 font-sans">
      <Sidebar
        me={me}
        projectId={projectId}
        onPickProject={(id) =>
          // 换项目就回到这个项目的起点：会话列表、概览、没有详情。
          go({ projectId: id, session: null, tab: "概览", detail: null })
        }
        onOpenAgent={(agentId) => go({ detail: { kind: "agent", agentId } })}
      />

      {!projectId || !project ? (
        <Center>{projectId ? "正在加载项目" : "还没有项目"}</Center>
      ) : loc.session ? (
        <Chat
          // 换 agent 就是换一个 DO 实例，重挂载比在 hook 里换连接可靠。
          key={`${me.email}~${loc.session}:${projectId}`}
          agentId={loc.session}
          projectId={projectId}
          owner={me.email}
          agent={projectAgents.find((a) => a.memberId === loc.session)}
          meName={me.name}
          firstPrompt={prompt}
          onBack={() => {
            setPrompt(undefined);
            go({ session: null });
            reload();
          }}
        />
      ) : (
        <SessionList
          project={project}
          agents={projectAgents}
          onOpen={(agentId, first) => {
            setPrompt(first);
            go({ session: agentId });
          }}
        />
      )}

      {stale && (
        // 角落里的一条，不接管界面。轮询一成功就消失。
        <div className="fixed bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-[#121313]/85 px-3 py-1.5 text-white text-[11px]/4">
          {stale}
        </div>
      )}

      {project && (
        <ProjectPanel
          project={project}
          meId={me.email}
          tab={loc.tab}
          detail={loc.detail}
          onTab={(tab: Tab) => go({ tab, detail: null })}
          onDetail={(detail: Detail) => go({ detail })}
          onOpenProject={(id) =>
            go({ projectId: id, session: null, tab: "概览", detail: null })
          }
          onReload={reload}
        />
      )}
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div className="grow flex items-center justify-center bg-white border-l border-[#E9E9E9] text-[#8A8A8A] text-xs/4">
      {children}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
