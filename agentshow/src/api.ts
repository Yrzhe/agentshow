import { z } from "zod";
import type { AgentProfile } from "./agent-identity";
import type { FileView, MeView, MemberView, ProjectView } from "./api-types";
import type { Member } from "./project-schema";

/**
 * 浏览器读写用的 HTTP 面。
 *
 * agent 走 routeAgentRequest 的 WebSocket，界面走这里 —— 两条路的区别是
 * 一个要流式推理、一个只要一次性的快照。硬塞进同一条通道只会让两边都别扭。
 *
 * 所有端点都在 verifyAccess 之后调用，email 是已经验过的身份，不是请求参数。
 */

/**
 * 既是 DO 实例名，又是 `${agentId}:${projectId}` 的组成部分。
 * 冒号必须挡掉 —— 放进去会把实例名切错，agent 会连到另一条 session 上。
 */
const SLUG = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "只能是小写字母、数字和连字符");

const CreateProject = z.object({
  projectId: SLUG,
  name: z.string().min(1).max(80)
});

const CreateAgent = z.object({
  agentId: SLUG,
  name: z.string().min(1).max(40),
  tagline: z.string().max(80).default(""),
  avatar: z.string().max(200).optional(),
  soul: z.string().max(8000).optional()
});

const AddMember = z.object({ agentId: SLUG });

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

function workspaceOf(env: Env, email: string) {
  return env.WorkspaceDO.get(env.WorkspaceDO.idFromName(email));
}

/** 邮箱的 @ 前半段。人类没有身份卡，显示名只能从已验证的身份里取。 */
function displayName(email: string): string {
  return email.split("@")[0] || email;
}

async function agentViews(env: Env, agentIds: string[]): Promise<MemberView[]> {
  const profiles = await Promise.all(
    agentIds.map((id) =>
      env.AgentIdentityDO.get(env.AgentIdentityDO.idFromName(id)).getProfile()
    )
  );
  return agentIds.map((id, i) => toAgentView(id, profiles[i]));
}

/**
 * 身份卡还没写过时 name 是空串，回落到 agentId ——
 * 界面上宁可显示一个 id，也不能显示一行空白。
 */
function toAgentView(agentId: string, p: AgentProfile): MemberView {
  return {
    memberId: agentId,
    kind: "agent",
    name: p.name || agentId,
    tagline: p.tagline || undefined,
    avatar: p.avatar
  };
}

async function projectView(
  env: Env,
  projectId: string,
  name: string
): Promise<ProjectView> {
  const project = env.ProjectDO.get(env.ProjectDO.idFromName(projectId));

  const [members, files, counts, activity, sessions] = await Promise.all([
    project.listMembers(),
    project.listFiles(),
    project.commentCounts(),
    project.listActivity(50),
    project.listSessions()
  ]);

  // agent 成员的简介和头像住在 AgentIdentityDO，members 表里只有名字。
  const profiles = await Promise.all(
    members.map((m) =>
      m.kind === "agent"
        ? env.AgentIdentityDO.get(
            env.AgentIdentityDO.idFromName(m.memberId)
          ).getProfile()
        : Promise.resolve(null)
    )
  );

  const memberViews: MemberView[] = members.map((m, i) => {
    const p = profiles[i];
    if (!p) return { memberId: m.memberId, kind: m.kind, name: m.name };
    return {
      memberId: m.memberId,
      kind: m.kind,
      // members 表里的名字是 @提及解析用的那个，优先它 —— 身份卡改名
      // 不该让界面显示的名字和能 @ 到的名字对不上。
      name: m.name || p.name || m.memberId,
      tagline: p.tagline || undefined,
      avatar: p.avatar
    };
  });

  const fileViews: FileView[] = files.map((f) => ({
    path: f.path,
    version: f.version,
    ownerId: f.ownerId,
    updatedAt: f.updatedAt,
    comments: counts[f.path] ?? 0
  }));

  return {
    projectId,
    name,
    members: memberViews,
    files: fileViews,
    activity,
    sessions
  };
}

/** 不是 `/api/` 开头就返回 null，交给后面的 agent 路由和静态资源。 */
export async function handleApi(
  request: Request,
  env: Env,
  email: string
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) return null;

  const parts = url.pathname.slice("/api/".length).split("/").filter(Boolean);
  const method = request.method;
  const workspace = workspaceOf(env, email);

  // GET /api/me —— 左栏的全部内容
  if (method === "GET" && parts[0] === "me" && parts.length === 1) {
    const [projects, agentIds] = await Promise.all([
      workspace.listProjects(),
      workspace.listAgents()
    ]);
    const me: MeView = {
      email,
      name: displayName(email),
      projects,
      agents: await agentViews(env, agentIds)
    };
    return json(me);
  }

  // POST /api/agents —— 造一个 agent：登记 + 写身份卡
  if (method === "POST" && parts[0] === "agents" && parts.length === 1) {
    const parsed = CreateAgent.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return json({ error: parsed.error.issues }, 400);
    const { agentId, name, tagline, avatar, soul } = parsed.data;

    const identity = env.AgentIdentityDO.get(
      env.AgentIdentityDO.idFromName(agentId)
    );
    await identity.setProfile({ name, tagline, avatar });
    if (soul) await identity.setIdentityDoc(soul);
    await workspace.addAgent(agentId);

    return json(toAgentView(agentId, { name, tagline, avatar }), 201);
  }

  if (parts[0] !== "projects") return json({ error: "not found" }, 404);

  // POST /api/projects —— 建 project，建的人立刻是成员
  if (method === "POST" && parts.length === 1) {
    const parsed = CreateProject.safeParse(
      await request.json().catch(() => null)
    );
    if (!parsed.success) return json({ error: parsed.error.issues }, 400);
    const { projectId, name } = parsed.data;

    await workspace.addProject({ projectId, name });

    const me: Member = {
      memberId: email,
      kind: "human",
      name: displayName(email)
    };
    await env.ProjectDO.get(env.ProjectDO.idFromName(projectId)).addMember(me);

    return json({ projectId, name }, 201);
  }

  const projectId = parts[1];
  if (!projectId) return json({ error: "not found" }, 404);

  // 只能读写自己工作台里的 project。projectId 是可猜的 slug，
  // 不查这一下的话，任何登录用户改一下 URL 就能读到别人的 project。
  const ref = await workspace.getProject(projectId);
  if (!ref) return json({ error: "not found" }, 404);

  // GET /api/projects/:id —— 右栏四个 tab 的全部数据
  if (method === "GET" && parts.length === 2) {
    return json(await projectView(env, projectId, ref.name));
  }

  // POST /api/projects/:id/members —— 把自己的 agent 拉进 project
  if (method === "POST" && parts[2] === "members" && parts.length === 3) {
    const parsed = AddMember.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return json({ error: parsed.error.issues }, 400);
    const { agentId } = parsed.data;

    // 不在自己工作台里的 agent 拉不进来 —— 否则可以把任意名字塞进成员表，
    // 而 @提及会照着这个名字去唤醒一个从不存在的 agent。
    const mine = await workspace.listAgents();
    if (!mine.includes(agentId)) return json({ error: "unknown agent" }, 400);

    const profile = await env.AgentIdentityDO.get(
      env.AgentIdentityDO.idFromName(agentId)
    ).getProfile();

    await env.ProjectDO.get(env.ProjectDO.idFromName(projectId)).addMember(
      { memberId: agentId, kind: "agent", name: profile.name || agentId },
      email
    );

    return json({ ok: true }, 201);
  }

  return json({ error: "not found" }, 404);
}
