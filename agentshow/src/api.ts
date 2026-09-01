import { z } from "zod";
import type { AgentProfile } from "./agent-identity";
import type {
  ActivityPage,
  AgentCardView,
  FileDetailView,
  FileView,
  MeView,
  MemberView,
  ProjectView
} from "./api-types";
import { isProjectId, scoped } from "./agent-key";
import { deliverMention } from "./mention";
import type { Member } from "./project-schema";
import type { WorkspaceDO } from "./workspace";

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
  // dm 是 DM 槽位的保留字，拿它当 project id 会和 DM 撞同一个实例名。
  projectId: SLUG.refine(isProjectId, "dm 是保留字，不能当项目 id"),
  name: z.string().min(1).max(80)
});

const CreateAgent = z.object({
  agentId: SLUG,
  name: z.string().min(1).max(40),
  tagline: z.string().max(80).default(""),
  description: z.string().max(600).optional(),
  capabilities: z.array(z.string().max(40)).max(8).optional(),
  avatar: z.string().max(200).optional(),
  readOnly: z.boolean().optional(),
  soul: z.string().max(8000).optional()
});

const AddMember = z.object({ agentId: SLUG });

const AddComment = z.object({
  path: z.string().min(1).max(400),
  text: z.string().min(1).max(4000),
  anchor: z.string().max(80).optional()
});

const SendMention = z.object({
  toAgentName: z.string().min(1).max(40),
  path: z.string().min(1).max(400),
  message: z.string().min(1).max(4000),
  /**
   * 这一次提及动作的 id，由发起方生成并在重试时复用。
   *
   * 缺省时服务端现生成一个，也就是「每次请求都是一次新的提及」——
   * 那样断线重试会把目标真的叫醒两次。前端必须传。
   */
  mentionId: z.string().min(8).max(64).optional()
});

/** 活动流一页多少条。轮询每次都会重取这一页，所以它同时是刷新的粒度。 */
const ACTIVITY_PAGE = 50;

/** 一次最多取多少条。上限的作用是挡住 ?limit=1000000 把整张表拖出来。 */
const ACTIVITY_MAX = 500;

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

/**
 * 身份卡的短 TTL 缓存。
 *
 * 界面每 4 秒轮询一次 project 快照，而快照要按成员逐个取身份卡 ——
 * 四个 agent 成员就是每 4 秒多打四次 AgentIdentityDO，取的是名字、简介、
 * 头像这些几乎从不变的东西。
 *
 * 缓存活在 isolate 里，所以它只是「变更最多晚 TTL 秒可见」，不是一致性保证。
 * 同一个 isolate 里的写入会就地失效；别的 isolate 靠 TTL 过期。
 * 这个取舍对头像和简介成立，对权限之类的东西不成立 —— 别往这里加那种字段。
 */
const PROFILE_TTL = 30_000;
const profileCache = new Map<string, { at: number; profile: AgentProfile }>();

async function cachedProfile(
  env: Env,
  owner: string,
  agentId: string
): Promise<AgentProfile> {
  const key = scoped(owner, agentId);
  const hit = profileCache.get(key);
  if (hit && Date.now() - hit.at < PROFILE_TTL) return hit.profile;

  const profile = await env.AgentIdentityDO.get(
    env.AgentIdentityDO.idFromName(key)
  ).getProfile();
  profileCache.set(key, { at: Date.now(), profile });
  return profile;
}

function forgetProfile(owner: string, agentId: string): void {
  profileCache.delete(scoped(owner, agentId));
}

async function agentViews(
  env: Env,
  owner: string,
  agentIds: string[]
): Promise<MemberView[]> {
  const profiles = await Promise.all(
    agentIds.map((id) => cachedProfile(env, owner, id))
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
  owner: string,
  projectId: string,
  name: string
): Promise<ProjectView> {
  const project = env.ProjectDO.get(
    env.ProjectDO.idFromName(scoped(owner, projectId))
  );

  const [members, files, counts, activity, sessions] = await Promise.all([
    project.listMembers(),
    project.listFiles(),
    project.commentCounts(),
    project.listActivity(ACTIVITY_PAGE),
    project.listSessions()
  ]);

  const oldest = activity[activity.length - 1];
  const activityHasMore = oldest
    ? await project.hasActivityBefore(oldest.id)
    : false;

  // agent 成员的简介和头像住在 AgentIdentityDO，members 表里只有名字。
  const profiles = await Promise.all(
    members.map((m) =>
      m.kind === "agent"
        ? cachedProfile(env, owner, m.memberId)
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
    activityHasMore,
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
      agents: await agentViews(env, email, agentIds)
    };
    return json(me);
  }

  // POST /api/agents —— 造一个 agent：登记 + 写身份卡
  if (method === "POST" && parts[0] === "agents" && parts.length === 1) {
    const parsed = CreateAgent.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return json({ error: parsed.error.issues }, 400);
    const { agentId, soul, ...profile } = parsed.data;

    const identity = env.AgentIdentityDO.get(
      env.AgentIdentityDO.idFromName(scoped(email, agentId))
    );
    await identity.setProfile(profile);
    if (soul) await identity.setIdentityDoc(soul);
    await workspace.addAgent(agentId);
    forgetProfile(email, agentId);

    return json(toAgentView(agentId, profile), 201);
  }

  // GET /api/agents/:id —— 身份卡
  if (method === "GET" && parts[0] === "agents" && parts.length === 2) {
    return agentCard(env, workspace, email, parts[1]);
  }

  if (parts[0] !== "projects") return json({ error: "not found" }, 404);

  // POST /api/projects —— 建 project，建的人立刻是成员
  if (method === "POST" && parts.length === 1) {
    const parsed = CreateProject.safeParse(
      await request.json().catch(() => null)
    );
    if (!parsed.success) return json({ error: parsed.error.issues }, 400);
    const { projectId, name } = parsed.data;

    // 先入成员表，再登记到工作台。
    //
    // 这两步跨两个 DO，做不成一次原子写；能选的只有失败时留下哪一半。
    // 反过来的话，第二步失败会留下一个「工作台里列着、但成员表里没有他」
    // 的 project：归属闸放行，而 ProjectDO 的 #kindOf 对不在表里的作者
    // 一律回退成 agent —— 他之后留的每条评论，活动流里的主语都是 agent。
    //
    // 现在这个顺序，失败留下的是一个还没登记的 ProjectDO：它不在任何列表里、
    // 直接访问被闸挡成 404，重试一次就好（addMember 是 upsert）。
    const me: Member = {
      memberId: email,
      kind: "human",
      name: displayName(email)
    };
    await env.ProjectDO.get(
      env.ProjectDO.idFromName(scoped(email, projectId))
    ).addMember(me);

    await workspace.addProject({ projectId, name });

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
    return json(await projectView(env, email, projectId, ref.name));
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

    const profile = await cachedProfile(env, email, agentId);

    await env.ProjectDO.get(
      env.ProjectDO.idFromName(scoped(email, projectId))
    ).addMember(
      { memberId: agentId, kind: "agent", name: profile.name || agentId },
      email
    );

    return json({ ok: true }, 201);
  }

  const project = env.ProjectDO.get(
    env.ProjectDO.idFromName(scoped(email, projectId))
  );

  // GET /api/projects/:id/file?path=… —— 文件详情
  //
  // 路径走查询参数不走 URL 段：文件路径里可以有斜杠，塞进路径段就得转义，
  // 而转义一旦漏一层，读到的就是另一个文件。
  if (method === "GET" && parts[2] === "file" && parts.length === 3) {
    const path = url.searchParams.get("path");
    if (!path) return json({ error: "missing path" }, 400);

    const [file, comments] = await Promise.all([
      project.readFile(path),
      project.listComments(path)
    ]);
    if (!file) return json({ error: "not found" }, 404);

    // readFile 只给内容和版本，归属和时间在列表里。
    const summary = (await project.listFiles()).find((f) => f.path === path);

    const detail: FileDetailView = {
      path,
      content: file.content,
      version: file.version,
      ownerId: summary?.ownerId ?? "",
      updatedAt: summary?.updatedAt ?? 0,
      comments
    };
    return json(detail);
  }

  // GET /api/projects/:id/activity?limit=N —— 展开更长的一段活动流
  //
  // 要的是「最近 N 条」而不是「某条之前的一页」。游标分页在这里会裂缝：
  // 界面每 4 秒重取一次最近 50 条，用户翻出来的那一页却是按当时的边界取的 ——
  // 期间新来的活动就掉进两段之间，谁也不显示。一整段重取没有这个问题。
  if (method === "GET" && parts[2] === "activity" && parts.length === 3) {
    const raw = url.searchParams.get("limit");
    const limit = raw === null ? NaN : Number(raw);
    if (!Number.isInteger(limit) || limit <= 0 || limit > ACTIVITY_MAX) {
      return json({ error: `limit 要是 1 到 ${ACTIVITY_MAX} 的整数` }, 400);
    }

    const activity = await project.listActivity(limit);
    const oldest = activity[activity.length - 1];
    const page: ActivityPage = {
      activity,
      hasMore: oldest ? await project.hasActivityBefore(oldest.id) : false
    };
    return json(page);
  }

  // POST /api/projects/:id/comments —— 人在文件上留一条评论
  if (method === "POST" && parts[2] === "comments" && parts.length === 3) {
    const parsed = AddComment.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return json({ error: parsed.error.issues }, 400);

    await project.addComment({ ...parsed.data, authorId: email });
    return json({ ok: true }, 201);
  }

  // POST /api/projects/:id/mentions —— 人在文件上 @ 一个 agent 把活接过去
  if (method === "POST" && parts[2] === "mentions" && parts.length === 3) {
    const parsed = SendMention.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return json({ error: parsed.error.issues }, 400);

    const result = await deliverMention(env, {
      owner: email,
      projectId,
      fromId: email,
      // 人不是任何提及的目标，链条从这里开始，恒为第 0 跳。
      depth: 0,
      ...parsed.data
    });
    // duplicate 是幂等成功：这条提及早就投递过了，重试不该报错。
    // 只有真的没送到（unknown_agent / max_depth）才是 400。
    const duplicated = !result.ok && result.reason === "duplicate";
    return json(result, result.ok || duplicated ? 201 : 400);
  }

  return json({ error: "not found" }, 404);
}

/**
 * 身份卡。
 *
 * `projects` 要挨个 project 问一遍 —— 成员关系存在各个 ProjectDO 里，
 * 没有反向索引。project 数量是个位数，为它建一张会漂的索引不划算。
 */
async function agentCard(
  env: Env,
  workspace: DurableObjectStub<WorkspaceDO>,
  owner: string,
  agentId: string
): Promise<Response> {
  const mine = await workspace.listAgents();
  if (!mine.includes(agentId)) return json({ error: "not found" }, 404);

  const identity = env.AgentIdentityDO.get(
    env.AgentIdentityDO.idFromName(scoped(owner, agentId))
  );
  const [profile, identityDoc, all] = await Promise.all([
    identity.getProfile(),
    identity.getIdentityDoc(),
    workspace.listProjects()
  ]);

  const membership = await Promise.all(
    all.map((p) =>
      env.ProjectDO.get(
        env.ProjectDO.idFromName(scoped(owner, p.projectId))
      ).hasMember(agentId)
    )
  );

  const card: AgentCardView = {
    agentId,
    name: profile.name || agentId,
    tagline: profile.tagline || undefined,
    description: profile.description,
    capabilities: profile.capabilities,
    avatar: profile.avatar,
    readOnly: profile.readOnly,
    identityDoc,
    projects: all.filter((_, i) => membership[i])
  };
  return json(card);
}
