import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { MeView, ProjectView } from "./api-types";
import { Chat } from "./ui/Chat";
import { ProjectPanel } from "./ui/ProjectPanel";
import { SessionList } from "./ui/SessionList";
import { Sidebar } from "./ui/Sidebar";
import "./styles.css";

/**
 * 三栏：人的东西 / 会话 / project 本身。
 *
 * 中栏和右栏都属于当前选中的 project，所以整个应用的状态只有三个：
 * 选了哪个 project、开着哪条 session、右栏在哪个 tab（那个由右栏自己管）。
 */

async function api<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return (await res.json()) as T;
}

/** 打开的会话。prompt 只在从输入框直接开一条新会话时有值。 */
type OpenSession = { agentId: string; prompt?: string };

function App() {
  const [me, setMe] = useState<MeView | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [project, setProject] = useState<ProjectView | null>(null);
  const [open, setOpen] = useState<OpenSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<MeView>("/api/me")
      .then((m) => {
        setMe(m);
        setProjectId((cur) => cur ?? m.projects[0]?.projectId ?? null);
      })
      .catch((e) => setError(String(e)));
  }, []);

  const reload = useCallback(() => {
    if (!projectId) return;
    api<ProjectView>(`/api/projects/${projectId}`)
      .then(setProject)
      .catch((e) => setError(String(e)));
  }, [projectId]);

  useEffect(() => {
    setProject(null);
    setOpen(null);
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

  if (error) return <Center>{error}</Center>;
  if (!me) return <Center>正在加载</Center>;

  const projectAgents =
    project?.members.filter((m) => m.kind === "agent") ?? [];

  return (
    <div className="flex h-full bg-[#F5F5F5] text-xs/4 font-sans">
      <Sidebar me={me} projectId={projectId} onPickProject={setProjectId} />

      {!projectId || !project ? (
        <Center>{projectId ? "正在加载项目" : "还没有项目"}</Center>
      ) : open ? (
        <Chat
          // 换 agent 就是换一个 DO 实例，重挂载比在 hook 里换连接可靠。
          key={`${open.agentId}:${projectId}`}
          agentId={open.agentId}
          projectId={projectId}
          agent={projectAgents.find((a) => a.memberId === open.agentId)}
          meName={me.name}
          firstPrompt={open.prompt}
          onBack={() => {
            setOpen(null);
            reload();
          }}
        />
      ) : (
        <SessionList
          project={project}
          agents={projectAgents}
          onOpen={(agentId, prompt) => setOpen({ agentId, prompt })}
        />
      )}

      {project && (
        <ProjectPanel
          project={project}
          meId={me.email}
          onOpenFile={() => {
            /* 文件详情在 Task 9 */
          }}
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
