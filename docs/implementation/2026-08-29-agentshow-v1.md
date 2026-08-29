# agentshow v1 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让第 9 节那条七步剧本真跑通 —— 两个 agent 在一个 project 里，一个干活产出文件，@ 另一个复审，全程在界面上可见。

**Architecture:** 两类 Durable Object。`AgentDO` 继承 `Think`，持有身份、记忆、私有盘和它的所有 session；`ProjectDO` 持有公共文件区（带版本）、讨论线程、成员名单、session 索引和活动流。agent 通过 `getTools()` 拿到六个作用于 project 公共区的工具，经 DO stub 调 `ProjectDO`。`Session = Agent × Project`。

**Tech Stack:** Cloudflare Workers · Durable Objects (SQLite) · `@cloudflare/think` · `agents` · `@cloudflare/shell` · Workers AI · React + Vite

**Spec:** `docs/architecture/agentshow-design.md`

## Global Constraints

以下每条都是硬约束，每个 Task 的要求隐含包含本节。违反任何一条都要停下来说明，不要自行放宽。

- **Node.js 24+**。版本钉死：`agents@0.21.0` · `@cloudflare/think@0.17.0` · `@cloudflare/shell@0.4.3`。
- **模型走 Workers AI**：`getModel()` 返回字符串 `"@cf/moonshotai/kimi-k2.7-code"`。Think 内置 `workers-ai-provider`，**不要**另外安装或 import 任何 provider 包。`wrangler.jsonc` 需要 `"ai": { "binding": "AI" }`。
- **自定义工具名不得与内置八个相撞**：`read` `write` `edit` `list` `find` `grep` `delete` `bash` 已被 Think 的 workspace 工具占用。Think 的工具合并是**后者覆盖前者**，撞名会静默顶掉内置工具且不报错。project 工具一律用 `xxxFile` / `xxxThread` 形式。
- **`workspaceBash = false`** 写在每个 Think 子类上。默认开启的 bash 工具会快照上千个文件。
- **`SessionManager` 的 `create` / `get` / `list` / `getSession` / `rename` 是同步方法**，不要 `await`。只有 `delete` 是 async。import 自 `agents/experimental/memory/session`。
- **存储只用 DO SQLite**。不接 R2、不接 Artifacts、不接容器、不接 `@cloudflare/computer`。
- **不写「留给以后」的分支**。范围外的东西（widgets / 三方合并 / 多人 / 角色权限）一行都不写，不留 TODO 分支。
- **每个 Step 结束就提交**，提交信息说明「为什么」。任何一步 commit 前跑 `npx tsc --noEmit` 和 `npx vitest run`，红的不许提交。

---

## File Structure

代码根目录是 `agentshow/`（工作区的内层代码目录）。

| 文件 | 职责 |
|---|---|
| `agentshow/src/server.ts` | Worker 入口，`routeAgentRequest` 路由，导出两个 DO 类 |
| `agentshow/src/agent.ts` | `AgentDO extends Think<Env>`：身份、session 路由、`getTools()` |
| `agentshow/src/agent-tools.ts` | 六个 project 工具的定义（zod schema + execute） |
| `agentshow/src/project.ts` | `ProjectDO`：文件、版本、线程、成员、索引、活动 |
| `agentshow/src/project-schema.ts` | ProjectDO 的建表 SQL 与行类型 |
| `agentshow/src/mention.ts` | @提及的解析、投递、深度计数 |
| `agentshow/src/client.tsx` | React 入口，三栏骨架 |
| `agentshow/src/ui/*.tsx` | 各面板组件，一个文件一个面板 |
| `agentshow/wrangler.jsonc` | DO 绑定、migrations、AI 绑定、assets |
| `agentshow/__tests__/*.test.ts` | vitest，DO 内部状态用 `runInDurableObject` |

拆分原则：`project.ts` 是这个系统里唯一会长的文件（文件 + 线程 + 成员 + 索引 + 活动五张表）。把建表和行类型抽到 `project-schema.ts`，把提及链抽到 `mention.ts`，让 `project.ts` 保持在四百行以内。超过就再拆。

---

## Task 1：脚手架 —— 一个能对话的 agent

**Files:**
- Create: `agentshow/package.json` · `agentshow/wrangler.jsonc` · `agentshow/vite.config.ts` · `agentshow/tsconfig.json` · `agentshow/index.html`
- Create: `agentshow/src/server.ts` · `agentshow/src/client.tsx`

**Interfaces:**
- Produces: `AgentDO` 类（DO 绑定名 `AgentDO`），Worker 默认导出

- [ ] **Step 1：装依赖**

```sh
cd agentshow
npm init -y
npm install @cloudflare/think@0.17.0 agents@0.21.0 @cloudflare/shell@0.4.3 ai zod react react-dom
npm install -D wrangler @cloudflare/vite-plugin @cloudflare/workers-types @vitejs/plugin-react @tailwindcss/vite tailwindcss typescript vite vitest @cloudflare/vitest-pool-workers
```

- [ ] **Step 2：写 `wrangler.jsonc`**

```jsonc
{
  "name": "agentshow",
  "compatibility_date": "2026-01-28",
  "compatibility_flags": ["nodejs_compat"],
  "ai": { "binding": "AI" },
  "assets": {
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/agents/*"]
  },
  "durable_objects": {
    "bindings": [
      { "class_name": "AgentDO", "name": "AgentDO" },
      { "class_name": "ProjectDO", "name": "ProjectDO" }
    ]
  },
  "migrations": [{ "new_sqlite_classes": ["AgentDO", "ProjectDO"], "tag": "v1" }],
  "main": "src/server.ts"
}
```

`ProjectDO` 现在就写进绑定和 migration，Task 2 才有类。先建一个空类占位，避免 Task 2 改 migration —— 改 migration tag 比多写三行麻烦得多。

- [ ] **Step 3：写 `src/server.ts`**

```ts
import { Think } from "@cloudflare/think";
import { routeAgentRequest } from "agents";
import { DurableObject } from "cloudflare:workers";

export class AgentDO extends Think<Env> {
  workspaceBash = false;

  getModel() {
    return "@cf/moonshotai/kimi-k2.7-code";
  }

  getSystemPrompt() {
    return "你是 agentshow 里的一个 agent。";
  }
}

export class ProjectDO extends DurableObject<Env> {}

export default {
  async fetch(request: Request, env: Env) {
    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 4：写 `src/client.tsx`，最小对话界面**

```tsx
import { createRoot } from "react-dom/client";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/think/react";

function Chat() {
  const agent = useAgent({ agent: "AgentDO" });
  const { messages, sendMessage, status } = useAgentChat({ agent });
  return (
    <div>
      {messages.map((m) => (
        <div key={m.id}>
          <b>{m.role}:</b>
          {m.parts.map((p, i) => (p.type === "text" ? <span key={i}>{p.text}</span> : null))}
        </div>
      ))}
      <button onClick={() => sendMessage({ text: "你好" })}>发一条</button>
      <p>{status}</p>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Chat />);
```

- [ ] **Step 5：跑起来，人工确认**

```sh
npx wrangler types      # 生成 Env
npx vite dev
```

打开页面点「发一条」，确认有流式回复。**这一步没通过不要往下走** —— 后面所有 Task 都假设模型能调通。

- [ ] **Step 6：提交**

```sh
git add agentshow && git commit -m "feat: 脚手架 + 一个能对话的 Think agent

Workers AI 起步，getModel 返回模型 id 字符串，Think 内置 provider 不另装包。
ProjectDO 空类先写进 migration，避免后面改 tag。"
```

---

## Task 1.5：Cloudflare Access 鉴权

原计划没有这一项。部署上线后 Worker 是个公开 URL，任何人都能对着它聊天、烧 Workers AI 额度 —— 在合 main 之前必须有闸。

**Files:** Create `agentshow/src/access.ts` · `agentshow/src/env.d.ts` · `agentshow/__tests__/access.test.ts` · `agentshow/vitest.config.ts`；Modify `agentshow/src/server.ts`

**Interfaces:**
```ts
type AccessResult = { ok: true; email: string } | { ok: false; response: Response };
verifyAccess(request, env, { isDev }): Promise<AccessResult>
accessUrls(teamDomain): { issuer: string; certsUrl: URL }
```

- [x] **Step 1：Worker 级开启 Access**（dashboard，需要人操作）—— 不需要自定义域名，策略挂在 Worker 上，所有域名和预览 URL 一起被保护
- [x] **Step 2：写 `verifyAccess`** —— `jose` 的 `jwtVerify` + `createRemoteJWKSet`，读 `cf-access-jwt-assertion`，校验 issuer 与 audience
- [x] **Step 3：测试** —— URL 两种形式推导、dev 旁路、三种配置缺失 fail closed、缺头、非法 token
- [x] **Step 4：接进 fetch 入口** —— 放在 `routeAgentRequest` 之前，一处同时挡住 HTTP 和 WebSocket
- [ ] **Step 5：配两个 secret** `POLICY_AUD` / `TEAM_DOMAIN`（`wrangler secret put`），端到端验证真实 JWT

三条设计约束，都不可放宽：

**配置缺失时 fail closed。** `POLICY_AUD` 或 `TEAM_DOMAIN` 任一为空，生产环境返回 500。绝不能在缺配置时降级成放行 —— 那等于把「鉴权坏了」变成「没有鉴权」，而且没有任何人会发现。

**token 有效但不带 email 也拒绝。** service token 之类的非人类身份能通过策略但没有邮箱。这个产品的人类成员必须有身份，放行成匿名会在 Task 4 的 members 表里留下一个无主的人。

**已验证的邮箱就是 members 表的人类身份。** 不要在 Task 4 另造一套用户标识 —— 那会立刻产生两个身份系统，且没有任何一个是权威的。

## Task 2：ProjectDO 的文件与版本 —— 乐观并发

这是整个系统里唯一会真正出错的地方，独立成 Task 独立过闸。

**Files:**
- Create: `agentshow/src/project-schema.ts` · `agentshow/__tests__/project-files.test.ts`
- Modify: `agentshow/src/project.ts`

**Interfaces:**
- Produces: `ProjectDO.readFile(path)` · `ProjectDO.writeFile(input)` · `ProjectDO.listFiles()`

```ts
type WriteInput  = { path: string; content: string; baseVersion: number; authorId: string };
type WriteResult =
  | { ok: true;  version: number }
  | { ok: false; reason: "stale"; version: number; content: string };
```

- [ ] **Step 1：先写失败的测试**

`agentshow/__tests__/project-files.test.ts`：

```ts
import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const stub = () => env.ProjectDO.get(env.ProjectDO.idFromName("p1"));

describe("乐观并发", () => {
  it("baseVersion 落后的写入被拒绝，并拿回当前内容", async () => {
    await runInDurableObject(stub(), async (p: any) => {
      const a = await p.writeFile({ path: "a.md", content: "v1", baseVersion: 0, authorId: "ferrule" });
      expect(a).toEqual({ ok: true, version: 1 });

      const b = await p.writeFile({ path: "a.md", content: "v2", baseVersion: 1, authorId: "ferrule" });
      expect(b).toEqual({ ok: true, version: 2 });

      // 拿着过期的 baseVersion=1 再写
      const c = await p.writeFile({ path: "a.md", content: "v2-并行", baseVersion: 1, authorId: "verdigris" });
      expect(c).toEqual({ ok: false, reason: "stale", version: 2, content: "v2" });
    });
  });

  it("被拒绝后文件不被污染", async () => {
    await runInDurableObject(stub(), async (p: any) => {
      const f = await p.readFile("a.md");
      expect(f).toEqual({ content: "v2", version: 2 });
    });
  });
});
```

- [ ] **Step 2：跑测试确认它红**

```sh
npx vitest run __tests__/project-files.test.ts
```

预期失败：`p.writeFile is not a function`。

- [ ] **Step 3：写建表 SQL**

`agentshow/src/project-schema.ts`：

```ts
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS files (
  path       TEXT PRIMARY KEY,
  content    TEXT NOT NULL,
  version    INTEGER NOT NULL,
  owner_id   TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

export type FileRow = {
  path: string;
  content: string;
  version: number;
  owner_id: string;
  updated_at: number;
};
```

- [ ] **Step 4：实现最小逻辑**

`agentshow/src/project.ts`：

```ts
import { DurableObject } from "cloudflare:workers";
import { SCHEMA, type FileRow } from "./project-schema";

export class ProjectDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(SCHEMA);
  }

  readFile(path: string): { content: string; version: number } | null {
    const row = this.ctx.storage.sql
      .exec<FileRow>("SELECT content, version FROM files WHERE path = ?", path)
      .toArray()[0];
    return row ? { content: row.content, version: row.version } : null;
  }

  writeFile(input: WriteInput): WriteResult {
    const current = this.readFile(input.path);
    const currentVersion = current?.version ?? 0;

    if (input.baseVersion !== currentVersion) {
      return {
        ok: false,
        reason: "stale",
        version: currentVersion,
        content: current?.content ?? ""
      };
    }

    const next = currentVersion + 1;
    this.ctx.storage.sql.exec(
      `INSERT INTO files (path, content, version, owner_id, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET content = ?, version = ?, updated_at = ?`,
      input.path, input.content, next, input.authorId, Date.now(),
      input.content, next, Date.now()
    );
    return { ok: true, version: next };
  }
}
```

`owner_id` 只在插入时写，更新不改 —— 文件的 owner 是**创建它的那个 agent**，别人改它不夺走归属。这是刻意的：Files 列表上那个 owner 头像回答的是「这东西是谁的」，不是「谁最后碰过」。

- [ ] **Step 5：跑测试确认绿，然后提交**

```sh
npx vitest run && npx tsc --noEmit
git add -A && git commit -m "feat(project): 文件读写与乐观并发

baseVersion 不匹配时拒绝，并把当前内容和版本一起返回 —— agent 可以直接在新内容上重做，
不用再读一次。owner 只在创建时定，后续修改不夺走归属。"
```

---

## Task 3：agent 的 project 工具

**Files:**
- Create: `agentshow/src/agent-tools.ts` · `agentshow/__tests__/agent-tools.test.ts`
- Modify: `agentshow/src/agent.ts`（从 `server.ts` 抽出 `AgentDO`）

**Interfaces:**
- Consumes: `ProjectDO.readFile` / `writeFile` / `listFiles`（Task 2）
- Produces: `AgentDO.getTools()` 返回 `listProjectFiles` · `readProjectFile` · `writeProjectFile`

- [ ] **Step 1：先写失败的测试 —— 工具名不撞内置**

```ts
import { describe, expect, it } from "vitest";
import { PROJECT_TOOL_NAMES } from "../src/agent-tools";

const BUILTIN = ["read", "write", "edit", "list", "find", "grep", "delete", "bash"];

describe("工具命名", () => {
  it("不与 Think 内置的八个 workspace 工具相撞", () => {
    for (const name of PROJECT_TOOL_NAMES) {
      expect(BUILTIN).not.toContain(name);
    }
  });
});
```

这个测试看着琐碎，但撞名的后果是**静默顶掉内置工具、没有任何报错** —— 值得一个自动化闸口。

- [ ] **Step 2：跑测试确认它红**

预期失败：找不到模块 `../src/agent-tools`。

- [ ] **Step 3：实现三个工具**

`agentshow/src/agent-tools.ts`：

```ts
import { tool } from "ai";
import { z } from "zod";

export const PROJECT_TOOL_NAMES = [
  "listProjectFiles",
  "readProjectFile",
  "writeProjectFile"
] as const;

export function projectTools(project: DurableObjectStub<ProjectDO>, authorId: string) {
  return {
    listProjectFiles: tool({
      description: "列出当前 project 公共区的所有文件",
      inputSchema: z.object({}),
      execute: async () => project.listFiles()
    }),

    readProjectFile: tool({
      description: "读 project 公共区的一个文件。返回内容和版本号，写回时必须带上这个版本号。",
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }) => project.readFile(path)
    }),

    writeProjectFile: tool({
      description:
        "写 project 公共区的文件。baseVersion 必须是你读到的那个版本号。" +
        "如果返回 stale，说明文件已被别人改动 —— 结果里带着当前内容和版本，" +
        "请在新内容的基础上重做你的修改，然后用新版本号重试。",
      inputSchema: z.object({
        path: z.string(),
        content: z.string(),
        baseVersion: z.number()
      }),
      execute: async (input) => project.writeFile({ ...input, authorId })
    })
  };
}
```

`writeProjectFile` 的 description 是这个 Task 里最重要的一段文字，不是注释。乐观并发能不能真的成立，取决于模型看懂 stale 之后知道要重做而不是报错放弃。写清楚「在新内容基础上重做」。

- [ ] **Step 4：接进 `AgentDO.getTools()`**

```ts
import type { ToolSet } from "ai";

getTools(): ToolSet {
  const projectId = this.currentProjectId();
  if (!projectId) return {};
  const stub = this.env.ProjectDO.get(this.env.ProjectDO.idFromName(projectId));
  return projectTools(stub, this.name);
}
```

- [ ] **Step 5：跑测试确认绿，提交**

```sh
npx vitest run && npx tsc --noEmit
git add -A && git commit -m "feat(agent): project 公共区的三个工具

工具名一律 xxxProjectFile，避开 Think 内置的 read/write/list —— 合并顺序是后者覆盖前者，
撞名会静默顶掉内置工具。writeProjectFile 的 description 显式教模型 stale 之后要重做。"
```

---

## Task 4：Session = Agent × Project

**Files:**
- Modify: `agentshow/src/agent.ts` · `agentshow/src/project.ts` · `agentshow/src/project-schema.ts`
- Create: `agentshow/__tests__/session-routing.test.ts`

**Interfaces:**
- Produces: `AgentDO.sessionIdFor(projectId)` · `ProjectDO.upsertSessionIndex(entry)` · `ProjectDO.listSessions()`

```ts
type SessionIndexEntry = {
  agentId: string; sessionId: string; title: string;
  status: "in_progress" | "done"; updatedAt: number;
};
```

- [ ] **Step 1：先写失败的测试**

```ts
describe("session 路由", () => {
  it("同一个 (agent, project) 永远命中同一条 session", async () => {
    await runInDurableObject(agentStub("ferrule"), async (a: any) => {
      expect(a.sessionIdFor("p1")).toBe(a.sessionIdFor("p1"));
      expect(a.sessionIdFor("p1")).not.toBe(a.sessionIdFor("p2"));
      expect(a.sessionIdFor(null)).toBe("dm");
    });
  });

  it("session 的 source 记着它属于哪个 project", async () => {
    await runInDurableObject(agentStub("ferrule"), async (a: any) => {
      const info = a.sessions.get(a.sessionIdFor("p1"));
      expect(info.source).toBe("project:p1");
    });
  });
});
```

- [ ] **Step 2：跑测试确认它红**

- [ ] **Step 3：接 SessionManager**

```ts
import { SessionManager } from "agents/experimental/memory/session";

export class AgentDO extends Think<Env> {
  sessions = SessionManager.create(this)
    .withContext("soul",   { provider: { get: async () => this.identityDoc() } })
    .withContext("memory", { description: "这个 agent 学到的东西", maxTokens: 1100 })
    .withCachedPrompt();

  sessionIdFor(projectId: string | null): string {
    const id = projectId ? `p_${projectId}` : "dm";
    if (!this.sessions.get(id)) {
      // 同步方法，不要 await
      this.sessions.create(projectId ? `project ${projectId}` : "DM", {
        source: projectId ? `project:${projectId}` : "dm"
      });
    }
    return id;
  }
}
```

`sessionId` 只需在这个 agent 自己的 DO 内唯一，所以 `p_<projectId>` 就够 —— 不用哈希，可读性比防碰撞重要。

- [ ] **Step 4：ProjectDO 侧建索引表**

在 `project-schema.ts` 追加：

```sql
CREATE TABLE IF NOT EXISTS session_index (
  agent_id   TEXT NOT NULL,
  session_id TEXT NOT NULL,
  title      TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'in_progress',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (agent_id, session_id)
);
```

status 存在这里而不是 session 里 —— `SessionInfo` 没有 status 字段，而项目视角本来就读这张索引。

- [ ] **Step 5：建 members 表**

Task 6 的提及解析要靠它查 agentName → agentId，Task 8 的成员区要靠它渲染。在 `project-schema.ts` 追加：

```sql
CREATE TABLE IF NOT EXISTS members (
  member_id  TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('human', 'agent')),
  name       TEXT NOT NULL,
  joined_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS members_by_name ON members (name);
```

`ProjectDO` 上加两个方法：

```ts
addMember(m: { memberId: string; kind: "human" | "agent"; name: string }): void
listMembers(): { memberId: string; kind: "human" | "agent"; name: string }[]
resolveAgentByName(name: string): string | null   // Task 6 用
```

**人和 agent 必须在同一张表里**，靠 `kind` 区分。分成两张表等于在数据层宣告 agent 是二等公民 —— 后面 Overview 的成员区、Activity 的主语、Files 的 owner 会被这个结构一路拖回「人在协作，agent 是工具」的形态。这是整个设计的支点，不是实现细节。

顺手补一条测试：`addMember` 两个 agent 一个人，`listMembers()` 返回三条且 `kind` 正确。

- [ ] **Step 6：跑测试确认绿，提交**

```sh
npx vitest run && npx tsc --noEmit
git add -A && git commit -m "feat: Session = Agent × Project 路由

sessionId 由 projectId 确定性派生，project 关联存进 SessionInfo.source。
状态放 ProjectDO 的索引表 —— SessionInfo 没有 status 字段，项目视角也本来就读索引。
soul / memory 直接用 SDK 原生的 context block 标签。"
```

---

## Task 5：讨论线程

**Files:** Modify `project-schema.ts` · `project.ts` · `agent-tools.ts`；Create `__tests__/threads.test.ts`

**Interfaces:**
- Produces: `ProjectDO.addComment({path, authorId, text})` · `ProjectDO.listComments(path)` · `ProjectDO.commentCounts()`
- 新工具：`commentOnProjectFile`

- [ ] **Step 1：写失败的测试** —— 三条评论落在两个文件上，`commentCounts()` 返回 `{ "a.md": 2, "b.md": 1 }`
- [ ] **Step 2：跑测试确认它红**
- [ ] **Step 3：建 `comments` 表**（`id` · `path` · `author_id` · `text` · `created_at`），实现三个方法
- [ ] **Step 4：加 `commentOnProjectFile` 工具**，`PROJECT_TOOL_NAMES` 同步补上（Task 3 的撞名测试会自动覆盖它）
- [ ] **Step 5：跑测试确认绿，提交**

`commentCounts()` 单独做一个方法而不是让前端 N 次查询 —— Files 列表每行都要显示评论数，这是一次查询和 N 次查询的区别。

---

## Task 6：@提及 —— 投递与唤醒

**Files:** Create `src/mention.ts` · `__tests__/mention.test.ts`；Modify `project.ts` · `agent.ts` · `agent-tools.ts`

**Interfaces:**
- Produces: `ProjectDO.mention({fromAgentId, toAgentName, path, message, depth})` · `AgentDO.notify(payload)`
- 新工具：`mentionAgent`

```ts
type MentionPayload = {
  projectId: string; fromAgentId: string;
  path: string; message: string; depth: number;
};
export const MAX_MENTION_DEPTH = 3;
```

- [ ] **Step 1：写失败的测试 —— 两条**

```ts
it("提及落在目标 agent 的 (agent, project) session 里，不是 DM", async () => { /* … */ });

it("互相提及在第 4 跳被拦下", async () => {
  // A @ B（depth 1）→ B @ A（2）→ A @ B（3）→ 第 4 跳必须被拒
  const r = await project.mention({ ...base, depth: MAX_MENTION_DEPTH + 1 });
  expect(r).toEqual({ ok: false, reason: "max_depth" });
});
```

第二条是必须有的。不做群聊消除了广播风暴，但没消除环 —— A @ B、B @ A 会一直烧钱，且在演示里撞上的概率不低。

- [ ] **Step 2：跑测试确认它红**
- [ ] **Step 3：实现 `mention.ts`** —— 解析 agentName → 查 members → 深度检查 → 取 AgentDO stub → `notify()`
- [ ] **Step 4：实现 `AgentDO.notify()`** —— 由 `sessionIdFor(projectId)` 取到那条 session，把提及作为一条 user 消息投进去并触发一轮
- [ ] **Step 5：加 `mentionAgent` 工具**，depth 从当前轮次继承 +1
- [ ] **Step 6：跑测试确认绿，提交**

被提及的 agent 不是本 project 成员时，工具返回明确失败让它在对话里说明 —— **不静默丢弃**。静默丢弃在演示里表现为「agent 说我 @ 了它，然后什么都没发生」，是最难查的一类。

---

## Task 7：活动流

**Files:** Modify `project-schema.ts` · `project.ts`；Create `__tests__/activity.test.ts`

**Interfaces:** `ProjectDO.listActivity(limit)`

```ts
type ActivityRow = {
  actorId: string; actorKind: "human" | "agent";
  verb: "created" | "updated" | "commented" | "mentioned" | "completed";
  targetType: "file" | "thread" | "session"; targetId: string; at: number;
};
```

- [ ] **Step 1：写失败的测试** —— 走一遍「写文件 → 评论 → 提及」，断言活动流按时间倒序返回三条，且 `actorKind` 全是 `agent`
- [ ] **Step 2：跑测试确认它红**
- [ ] **Step 3：建 `activity` 表，在 `writeFile` / `addComment` / `mention` 里各记一条**
- [ ] **Step 4：跑测试确认绿，提交**

`actorKind` 这一列是整个演示的题眼 —— 活动流的主语必须能是 agent。写进 schema 而不是在前端推断。

---

## Task 8：前端 —— 三栏与 Project 面板

**Files:** Modify `src/client.tsx`；Create `src/ui/Sidebar.tsx` · `src/ui/SessionList.tsx` · `src/ui/ProjectPanel.tsx` · `src/ui/FilesTab.tsx` · `src/ui/ActivityTab.tsx` · `src/ui/OverviewTab.tsx`

**Interfaces:** Consumes 前面所有 `ProjectDO` 的读方法

- [ ] **Step 1：三栏骨架** —— 左 project 与 agent 列表，中 session 列表，右 project 面板
- [ ] **Step 2：Overview** —— 成员（人和 agent 混排，agent 显示身份卡摘要）、共享文件、最近活动
- [ ] **Step 3：Files** —— 每行 owner 头像 + 评论数 + 版本号
- [ ] **Step 4：Activity** —— 主语是 agent
- [ ] **Step 5：人工过一遍界面，提交**

视觉基准是 Paper 文件 `youware` 的 `project-collaboration` 页。**但那套设计里所有行动者都是人** —— Members 全是人带邮箱、Activity 主语全是人、文件 owner 全是人。照搬会把整个赌注稀释掉。三处必须替换：成员表人和 agent 混排；活动流主语是 agent；文件 owner 显示 agent 头像。

界面不写自动化测试 —— 演示价值全在真实交互上，时间花在把剧本跑顺。

---

## Task 9：文件详情与身份卡

**Files:** Create `src/ui/FileDetail.tsx` · `src/ui/AgentCard.tsx`

- [ ] **Step 1：文件详情** —— 内容 + 版本 + owner + 讨论线程
- [ ] **Step 2：身份卡** —— 名字、简介、能力、它在哪些 project 里
- [ ] **Step 3：人工过一遍，提交**

---

## Task 10：跑通七步剧本

**Files:** Create `agentshow/scripts/seed.ts`（建 project、建两个 agent、写身份卡）

- [ ] **Step 1：seed 脚本** —— 一个 project，两个 agent：一个实现、一个复审，各有身份卡和 `soul`
- [ ] **Step 2：走一遍剧本，逐步核对**

| # | 动作 | 在哪看到 |
|---|---|---|
| 1 | project 里两个 agent | Overview 成员区 |
| 2 | 跟实现 agent 说「把这块改了」 | 对话页 |
| 3 | 它产出文件 | Files，owner 是它 |
| 4 | 它 @ 复审 agent | Activity 一条 `mentioned` |
| 5 | 复审 agent 醒来留两条评论 | Files 评论数变 2 |
| 6 | 全程可见 | Activity，主语全是 agent |
| 7 | 点进复审 agent 的 session | 看到它的推理 |

- [ ] **Step 3：制造一次真冲突** —— 让两个 agent 同时改同一文件，确认后写的那个收到 stale 并**自己重做成功**。这一步是整个计划里最可能第一次不 work 的地方：模型可能把 stale 当错误报给用户就停下。不通就回 Task 3 Step 3 改 `writeProjectFile` 的 description，不要改代码逻辑。
- [ ] **Step 4：录视频**
- [ ] **Step 5：提交，更新 `CHANGELOG.md`**
