# AgentShow — 工程规格文档

> 本文档是写给工程师的可执行规格。按 Step 顺序执行，每步有验收标准。
> 设计背景和产品逻辑参见 `IMPLEMENTATION_PLAN.md`。

**项目根目录**: 当前 Google Drive 目录（`pagefly/`，后续改名为 `agentshow`）
**开源项目**: 是。需要 .gitignore, LICENSE, README, examples。

### node_modules 处理（Google Drive 项目通用方案）

项目在 Google Drive 中，`node_modules` 和 `dist` 通过 symlink 存在本地，避免 Drive 同步碎文件：

```bash
# 统一存储位置
~/.local/node_modules_store/{project-name}/node_modules

# 设置方法（每个项目跑一次）
mkdir -p ~/.local/node_modules_store/agentshow
pnpm install                    # 先正常安装
mv node_modules ~/.local/node_modules_store/agentshow/node_modules
ln -s ~/.local/node_modules_store/agentshow/node_modules node_modules
```

Git 忽略（.gitignore）+ Drive 不跟踪 symlink 内容 + Node.js 透过 symlink 正常读取。三方互不干扰。

---

## Monorepo 总体结构

```
agentshow/                        # 项目根目录
├── package.json                  # Workspace root（不发布）
├── pnpm-workspace.yaml
├── tsconfig.base.json            # 共享 TS 配置
├── .gitignore
├── .editorconfig
├── LICENSE                       # MIT
├── README.md
├── CHANGELOG.md
├── docs/                         # 已有的设计和分析文档
├── examples/
│   └── claude-code-setup/
│       ├── README.md             # 安装指南
│       └── settings.example.json # Claude Code MCP 配置示例
└── packages/
    ├── shared/                   # @agentshow/shared — 共享类型和工具
    │   ├── package.json
    │   ├── tsconfig.json
    │   └── src/
    │       ├── index.ts
    │       ├── types.ts          # 所有类型定义
    │       ├── constants.ts      # 前缀、超时时间等常量
    │       └── id.ts             # nanoid 生成函数
    └── mcp/                      # @agentshow/mcp — 本地 MCP Server
        ├── package.json
        ├── tsconfig.json
        ├── vitest.config.ts
        ├── src/
        │   ├── index.ts          # 入口：启动 MCP Server
        │   ├── server.ts         # MCP Server 配置 + Tool 注册
        │   ├── db/
        │   │   ├── connection.ts # SQLite 连接
        │   │   ├── schema.ts     # 建表 SQL
        │   │   └── queries.ts    # CRUD 纯函数
        │   ├── project/
        │   │   └── detect.ts     # .agentshow.json 查找/创建
        │   ├── tools/
        │   │   ├── register-status.ts
        │   │   ├── get-peers.ts
        │   │   ├── notes.ts      # share_note + get_notes + delete_note
        │   │   └── project-history.ts
        │   └── lifecycle/
        │       └── cleanup.ts    # 进程退出 + 超时清理
        └── tests/
            ├── db.test.ts
            ├── project-detect.test.ts
            └── tools.test.ts
```

---

## Step 1: Monorepo 脚手架

### 1.1 初始化

```bash
# 在项目根目录执行
git init
pnpm init
mkdir -p packages/shared/src packages/mcp/src packages/mcp/tests
mkdir -p examples/claude-code-setup
```

### 1.2 Root package.json

```json
{
  "name": "agentshow",
  "version": "0.1.0",
  "private": true,
  "description": "Let your AI agents know what each other is doing",
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "dev": "pnpm --filter @agentshow/mcp dev",
    "clean": "pnpm -r clean"
  },
  "engines": {
    "node": ">=20.0.0",
    "pnpm": ">=9.0.0"
  },
  "packageManager": "pnpm@9.15.4",
  "license": "MIT",
  "author": "yrzhe",
  "repository": {
    "type": "git",
    "url": "https://github.com/yrzhe/agentshow"
  }
}
```

### 1.3 pnpm-workspace.yaml

```yaml
packages:
  - "packages/*"
```

### 1.4 tsconfig.base.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

### 1.5 .gitignore

```gitignore
# Dependencies
node_modules/

# Build
dist/
*.tsbuildinfo

# IDE
.vscode/
.idea/
*.swp
*.swo
.DS_Store

# Environment
.env
.env.local
.env.*.local

# AgentShow runtime data
.agentshow.json

# Test
coverage/

# OS
Thumbs.db
```

### 1.6 .editorconfig

```ini
root = true

[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true
```

### 1.7 LICENSE

MIT License, Copyright (c) 2026 yrzhe

### 1.8 README.md

```markdown
# AgentShow

Let your AI agents know what each other is doing.

AgentShow is a local MCP Server that enables multiple Claude Code sessions
to share context, coordinate work, and avoid duplication — automatically.

## Quick Start

```bash
pnpm install
pnpm build
```

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "agentshow": {
      "command": "node",
      "args": ["<path-to-agentshow>/packages/mcp/dist/index.js"]
    }
  }
}
```

See [examples/claude-code-setup/](examples/claude-code-setup/) for details.

## How It Works

[Diagram and explanation]

## Packages

| Package | Description |
|---------|-------------|
| `@agentshow/shared` | Shared types and utilities |
| `@agentshow/mcp` | Local MCP Server for Claude Code |

## License

MIT
```

### 1.9 验收标准

```bash
pnpm install    # 无报错
pnpm build      # 无报错（此时 build 可以是空操作）
git status      # 所有文件可追踪，.gitignore 生效
```

---

## Step 2: Shared Types Package

### 2.1 packages/shared/package.json

```json
{
  "name": "@agentshow/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts --clean",
    "clean": "rm -rf dist"
  },
  "devDependencies": {
    "tsup": "^8.4.0",
    "typescript": "^5.7.0"
  },
  "dependencies": {
    "nanoid": "^5.1.0"
  }
}
```

### 2.2 packages/shared/tsconfig.json

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

### 2.3 packages/shared/src/types.ts

```typescript
// ============================================================
// .agentshow.json — 项目身份文件
// ============================================================
export interface ProjectIdentity {
  /** 项目唯一 ID，如 "proj_a7x9k2" */
  id: string
  /** 项目显示名，如 "pagefly" */
  name: string
}

// ============================================================
// Database Records
// ============================================================
export interface SessionRecord {
  id: string
  project_id: string
  project_name: string
  cwd: string
  task: string | null
  files: string | null          // JSON array string
  conversation_path: string | null
  status: 'active' | 'inactive'
  started_at: string
  last_heartbeat: string
}

export interface NoteRecord {
  id: number
  project_id: string
  session_id: string | null
  key: string
  content: string
  created_at: string
  updated_at: string
}

export interface SessionHistoryRecord {
  id: string
  project_id: string
  project_name: string
  task: string | null
  summary: string | null
  conversation_path: string | null
  started_at: string
  ended_at: string
}

// ============================================================
// Tool Inputs
// ============================================================
export interface RegisterStatusInput {
  /** Agent 的工作目录（首次必传，后续可省略） */
  cwd?: string
  /** 当前任务描述 */
  task?: string
  /** 正在操作的文件列表 */
  files?: string[]
}

export interface GetPeersInput {
  /** "all" 返回所有 project 摘要，省略则返回同 project 详情 */
  scope?: 'all'
  /** 跨 project 查询指定项目名 */
  project?: string
}

export interface ShareNoteInput {
  /** Note 的唯一标识 key（同 project 下唯一） */
  key: string
  /** Note 内容 */
  content: string
}

export interface GetNotesInput {
  /** 跨 project 查询 */
  project?: string
  /** 按时间过滤（ISO 8601） */
  since?: string
  /** 关键词搜索（匹配 key + content） */
  search?: string
}

export interface DeleteNoteInput {
  /** 要删除的 note key */
  key: string
}

export interface GetProjectHistoryInput {
  /** 指定 project（默认当前 project） */
  project?: string
  /** 按时间过滤 */
  since?: string
  /** 关键词搜索 */
  search?: string
}

// ============================================================
// Tool Outputs
// ============================================================
export interface RegisterStatusOutput {
  session_id: string
  project_id: string
  project_name: string
  status: 'registered' | 'updated'
}

export interface PeerInfo {
  session_id: string
  task: string | null
  files: string[]
  started_at: string
  last_heartbeat: string
}

export interface GetPeersOutput {
  project: string
  peers: PeerInfo[]
  notes_count: number
}

export interface GetPeersAllOutput {
  projects: Array<{
    project_id: string
    name: string
    active_sessions: number
    notes_count: number
  }>
}

export interface NoteInfo {
  id: number
  key: string
  content: string
  session_id: string | null
  created_at: string
  updated_at: string
}

export interface GetNotesOutput {
  project: string
  notes: NoteInfo[]
}

export interface ShareNoteOutput {
  id: number
  key: string
  status: 'created' | 'updated'
}

export interface DeleteNoteOutput {
  status: 'deleted' | 'not_found'
}

export interface GetProjectHistoryOutput {
  project: string
  sessions: Array<{
    id: string
    task: string | null
    summary: string | null
    started_at: string
    ended_at: string
  }>
  notes: NoteInfo[]
}
```

### 2.4 packages/shared/src/constants.ts

```typescript
/** ID 前缀 */
export const PROJECT_ID_PREFIX = 'proj_'
export const SESSION_ID_PREFIX = 'ses_'

/** nanoid 长度（不含前缀） */
export const ID_LENGTH = 8

/** 项目身份文件名 */
export const PROJECT_IDENTITY_FILE = '.agentshow.json'

/** 数据库文件路径 */
export const DB_DIR = '.agentshow'
export const DB_FILE = 'agentshow.db'

/** Session 超时时间（毫秒） */
export const SESSION_TIMEOUT_MS = 5 * 60 * 1000  // 5 分钟

/** AgentShow 数据库 schema 版本 */
export const SCHEMA_VERSION = 1
```

### 2.5 packages/shared/src/id.ts

```typescript
import { nanoid } from 'nanoid'
import { PROJECT_ID_PREFIX, SESSION_ID_PREFIX, ID_LENGTH } from './constants.js'

export function generateProjectId(): string {
  return `${PROJECT_ID_PREFIX}${nanoid(ID_LENGTH)}`
}

export function generateSessionId(): string {
  return `${SESSION_ID_PREFIX}${nanoid(ID_LENGTH)}`
}
```

### 2.6 packages/shared/src/index.ts

```typescript
export * from './types.js'
export * from './constants.js'
export * from './id.js'
```

### 2.7 验收标准

```bash
cd packages/shared && pnpm build   # 生成 dist/index.js + dist/index.d.ts
# 检查 dist/ 中类型导出正确
```

---

## Step 3: Database Layer

### 3.1 packages/mcp/package.json

```json
{
  "name": "@agentshow/mcp",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "bin": {
    "agentshow-mcp": "dist/index.js"
  },
  "scripts": {
    "build": "tsup src/index.ts --format esm --clean --banner.js '#!/usr/bin/env node'",
    "dev": "tsup src/index.ts --format esm --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@agentshow/shared": "workspace:*",
    "@modelcontextprotocol/sdk": "^1.12.0",
    "better-sqlite3": "^11.8.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.12",
    "tsup": "^8.4.0",
    "typescript": "^5.7.0",
    "vitest": "^3.1.0"
  }
}
```

### 3.2 packages/mcp/tsconfig.json

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

### 3.3 packages/mcp/vitest.config.ts

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
  },
})
```

### 3.4 packages/mcp/src/db/connection.ts

功能：
- 在 `~/.agentshow/` 下创建目录（如不存在）
- 打开 SQLite 数据库，启用 WAL 模式
- 导出 `getDb()` 函数（单例，首次调用时初始化）
- 接受可选的 `dbPath` 参数用于测试时传入临时路径
- 调用 `schema.ts` 中的 `initSchema(db)` 建表

### 3.5 packages/mcp/src/db/schema.ts

功能：
- 导出 `initSchema(db: Database)` 函数
- 执行建表 SQL（见 IMPLEMENTATION_PLAN.md 中的 Schema 部分）
- 包含 schema 版本检查（`PRAGMA user_version`），为未来迁移预留
- 3 张表：`sessions`、`notes`、`session_history`
- 3 个索引

### 3.6 packages/mcp/src/db/queries.ts

纯函数，每个函数接受 `db: Database` 作为第一个参数。不持有状态。

```typescript
// Session CRUD
insertSession(db, record: Omit<SessionRecord, 'started_at' | 'last_heartbeat'>): void
updateSession(db, id: string, updates: Partial<Pick<SessionRecord, 'task' | 'files' | 'status' | 'last_heartbeat'>>): void
getActiveSessionsByProject(db, projectId: string, excludeSessionId?: string): SessionRecord[]
getActiveSessionsSummary(db): Array<{ project_id: string, project_name: string, active_sessions: number, notes_count: number }>
markInactive(db, sessionId: string): void
markStaleSessionsInactive(db, timeoutMs: number): string[]  // 返回被标记的 session id 列表

// Notes CRUD
upsertNote(db, projectId: string, sessionId: string | null, key: string, content: string): { id: number, status: 'created' | 'updated' }
getNotesByProject(db, projectId: string, opts?: { since?: string, search?: string }): NoteRecord[]
deleteNote(db, projectId: string, key: string): boolean

// Session History
insertSessionHistory(db, record: Omit<SessionHistoryRecord, 'ended_at'>): void
getSessionHistory(db, projectId: string, opts?: { since?: string, search?: string }): SessionHistoryRecord[]
```

### 3.7 tests/db.test.ts

测试用例：

1. **建表**: 新建 db → initSchema → 表存在
2. **Session CRUD**: insert → getActive → update → getActive 验证变更 → markInactive
3. **Notes upsert**: insert → 相同 key insert → 确认是 update 不是新增
4. **Notes 搜索**: 插入多条 → search 过滤 → since 过滤
5. **Notes 删除**: delete 已有 key → 返回 true，delete 不存在 key → 返回 false
6. **超时清理**: insert → 手动设置 last_heartbeat 为 6 分钟前 → markStale → 确认被标记
7. **Session History**: markInactive → insertHistory → getHistory 验证
8. **并发**: 两个 db 连接同时读写 → 无报错（验证 WAL 模式）

所有测试使用临时文件路径（`os.tmpdir()`），测试结束后清理。

### 3.8 验收标准

```bash
cd packages/mcp && pnpm test   # 所有 db 测试通过
```

---

## Step 4: Project Identification

### 4.1 packages/mcp/src/project/detect.ts

功能：

```typescript
/**
 * 从给定 cwd 检测或创建项目身份。
 *
 * 1. 从 cwd 往上逐级查找 .agentshow.json
 *    → 找到：读取并返回 { id, name, root }
 *
 * 2. 没找到：确定项目根目录
 *    a. 从 cwd 往上找 .git 目录 → git 根目录 = 项目根
 *    b. 没有 .git → cwd 本身 = 项目根
 *
 * 3. 推导项目名（优先级）：
 *    a. package.json 的 name 字段
 *    b. 目录名（basename）
 *
 * 4. 在项目根创建 .agentshow.json
 *    - id: generateProjectId()
 *    - name: 推导出的项目名
 *
 * 5. 检查 .gitignore，必要时追加 .agentshow.json
 *
 * 返回 { id, name, root }
 */
export function detectProject(cwd: string): ProjectDetectResult

export interface ProjectDetectResult {
  id: string
  name: string
  root: string       // 项目根目录绝对路径
  created: boolean   // 是否新创建了 .agentshow.json
}
```

辅助函数（不导出，模块内部用）：

```typescript
/** 往上逐级查找指定文件名，返回找到的完整路径或 null */
function findFileUpwards(startDir: string, fileName: string): string | null

/** 从 cwd 确定项目根目录：先找 .git，再 fallback 到 cwd */
function findProjectRoot(cwd: string): string

/** 从项目根推导项目名 */
function inferProjectName(root: string): string

/** 如果 .gitignore 存在且不含目标行，则追加 */
function ensureGitignore(root: string, line: string): void
```

### 4.2 tests/project-detect.test.ts

测试用例（全部在 `os.tmpdir()` 下的临时目录操作）：

1. **首次检测（无 .git）**: 空目录 → detectProject → 创建了 .agentshow.json，name = 目录名
2. **首次检测（有 .git）**: 目录含 .git → detectProject → .agentshow.json 创建在 git 根
3. **子目录检测**: 在 root/src/deep/ 调用 → 找到 root/.agentshow.json
4. **重复检测**: 已有 .agentshow.json → 读取返回，不创建新的，created = false
5. **package.json name**: 根目录有 package.json → name 取 package.json 的 name
6. **.gitignore 追加**: 有 .gitignore 但没有 .agentshow.json 行 → 追加
7. **.gitignore 已有**: .gitignore 已含 .agentshow.json → 不重复追加
8. **无 .gitignore**: 不创建 .gitignore

### 4.3 验收标准

```bash
cd packages/mcp && pnpm test   # db + project-detect 测试全部通过
```

---

## Step 5: MCP Server + 4 Tools

### 5.1 packages/mcp/src/server.ts

功能：
- 使用 `@modelcontextprotocol/sdk` 创建 MCP Server
- 注册 4 组 tools（共 6 个 tool）
- 每个 tool 的 `inputSchema` 用 JSON Schema 定义（对应 shared 中的 Input 类型）
- 维护当前进程的 `sessionId` 和 `projectId`（在首次 register_status 后设置）
- 每次 tool 调用时更新 `last_heartbeat`
- 调用 `lifecycle/cleanup.ts` 注册进程退出钩子

### 5.2 packages/mcp/src/index.ts

```typescript
// 入口文件
// 1. 初始化数据库
// 2. 创建 MCP Server
// 3. 通过 stdio transport 启动
```

### 5.3 Tool 实现规格

每个 tool 文件导出一个 handler 函数，签名统一：

```typescript
type ToolHandler = (
  input: XxxInput,
  ctx: { db: Database, sessionId: string | null, projectId: string | null }
) => XxxOutput
```

#### register-status.ts

- 首次调用（sessionId 为 null）：
  1. 调用 `detectProject(input.cwd)` 获取 project 信息
  2. 生成 sessionId
  3. 推导 `conversation_path`（Claude Code JSONL 路径）
  4. 写入 sessions 表
  5. 在模块级别设置 sessionId 和 projectId
  6. 返回 `{ session_id, project_id, project_name, status: 'registered' }`
- 后续调用（sessionId 已存在）：
  1. 更新 task / files / last_heartbeat
  2. 返回 `{ ..., status: 'updated' }`

#### get-peers.ts

- 先调用 `markStaleSessionsInactive` 做惰性清理
- `scope === 'all'`：调用 `getActiveSessionsSummary`，返回所有 project
- `project` 参数指定：按 project_name 查询（需要先从 db 查 project_id）
- 默认：按当前 projectId 查询，排除自己的 sessionId
- `files` 字段从 JSON string 解析为数组

#### notes.ts

导出 3 个 handler：
- `handleShareNote`：调用 `upsertNote`
- `handleGetNotes`：调用 `getNotesByProject`，支持 project/since/search 参数
- `handleDeleteNote`：调用 `deleteNote`

跨 project 查询时：如果传了 `project` 参数，需要根据 project_name 查找对应的 project_id（从 sessions 或 session_history 表中查）。

#### project-history.ts

- 调用 `getSessionHistory` 和 `getNotesByProject`
- 合并返回

### 5.4 Tool JSON Schema 定义

每个 tool 需要定义 `name`、`description`、`inputSchema`。

| Tool Name | Description |
|-----------|-------------|
| `register_status` | Register or update what this session is working on. Call at the start of each task. |
| `get_peers` | See what other agent sessions are doing, either in this project or across all projects. |
| `share_note` | Share a finding or decision with other sessions in this project. Same key = update. |
| `get_notes` | Read shared notes from this or another project. |
| `delete_note` | Delete a shared note by key. |
| `get_project_history` | View past session summaries and notes for a project. |

### 5.5 tests/tools.test.ts

集成测试（使用临时 db）：

1. **register_status 首次调用**: 传入临时 cwd → 返回 session_id + project_id → db 中有记录
2. **register_status 更新**: 再次调用改 task → db 中 task 更新，last_heartbeat 更新
3. **get_peers 同 project**: 注册两个 session → 互相能看到对方，看不到自己
4. **get_peers scope=all**: 注册不同 project 的 session → 返回摘要列表
5. **share_note + get_notes**: share → get 能读到 → 再 share 同 key → 是 update
6. **delete_note**: share → delete → get 读不到
7. **get_notes search**: 插入多条 → search 过滤正确
8. **get_project_history**: 有 history 记录 + notes → 合并返回
9. **惰性超时清理**: 注册 session → 手动设超时 → get_peers 触发清理 → 旧 session 消失

### 5.6 验收标准

```bash
cd packages/mcp && pnpm test   # 所有测试通过
pnpm build                     # 构建成功
# 用 MCP Inspector 手动测试（可选）：
npx @modelcontextprotocol/inspector node packages/mcp/dist/index.js
```

---

## Step 6: Lifecycle + Examples + Installation

### 6.1 packages/mcp/src/lifecycle/cleanup.ts

```typescript
/**
 * 注册进程退出钩子。
 * 在 server.ts 中调用一次。
 *
 * 监听事件：
 * - process.on('exit')
 * - process.on('SIGINT')
 * - process.on('SIGTERM')
 *
 * 清理动作：
 * 1. 将当前 session 标记为 inactive
 * 2. 写入 session_history（task 从 sessions 表读取）
 * 3. 关闭 db 连接
 */
export function registerCleanupHooks(
  db: Database,
  getSessionId: () => string | null,
  getProjectInfo: () => { id: string, name: string } | null
): void
```

### 6.2 examples/claude-code-setup/settings.example.json

```json
{
  "mcpServers": {
    "agentshow": {
      "command": "node",
      "args": ["/absolute/path/to/agentshow/packages/mcp/dist/index.js"]
    }
  }
}
```

### 6.3 examples/claude-code-setup/README.md

安装步骤：
1. Clone repo
2. `pnpm install && pnpm build`
3. 复制 MCP 配置到 `~/.claude/settings.json`
4. 修改 args 中的路径
5. 重启 Claude Code
6. 验证：在 Claude Code 中调用 `agentshow.register_status`

### 6.4 examples/claude-code-setup/CLAUDE.md.example

```markdown
## AgentShow 协作

本项目已接入 AgentShow，请遵循以下规范：

- 开始新任务时，调用 `agentshow.register_status` 汇报你在做什么
- 遇到重要发现或决策变更时，调用 `agentshow.share_note` 共享给其他 session
- 开始工作前，调用 `agentshow.get_peers` 看看有没有其他 session 在做相关的事
- 完成阶段性工作时，更新 `agentshow.register_status` 中的 task 描述
```

### 6.5 Root CHANGELOG.md

```markdown
# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - 2026-04-XX

### Added
- Local MCP Server for multi-session coordination
- Project identification via `.agentshow.json`
- 6 MCP tools: register_status, get_peers, share_note, get_notes, delete_note, get_project_history
- SQLite storage with WAL mode for concurrent access
- Automatic session lifecycle management
- Example configuration for Claude Code
```

### 6.6 验收标准

```bash
# 完整构建
pnpm install && pnpm build && pnpm test

# 端到端验证（在真实 Claude Code 中）
# 1. 配置 MCP Server
# 2. 开两个 Claude Code session 指向同一个项目
# 3. Session A: register_status + share_note
# 4. Session B: get_peers → 能看到 Session A
# 5. Session B: get_notes → 能读到 Session A 的 note
# 6. 关闭 Session A → Session B get_peers → Session A 消失
```

---

## 扩展性设计要点

### 未来 package 预留

Monorepo 结构已为后续阶段预留：

```
packages/
├── shared/     ← 已实现（Step 2）
├── mcp/        ← 已实现（Step 3-6）
├── cli/        ← 阶段 2: CLI 工具（agentshow push/login/list）
├── worker/     ← 阶段 2: Cloudflare Worker 后端
├── web/        ← 阶段 2: 前端渲染
└── sdk/        ← 阶段 3: 第三方集成 SDK
```

所有 package 共享 `@agentshow/shared` 中的类型，确保本地和云端数据结构一致。

### 多 Agent 工具支持预留

当前只解析 Claude Code 的对话文件路径。未来要支持 Cursor / ChatGPT 等，在 `shared/types.ts` 中可扩展：

```typescript
export type AgentTool = 'claude-code' | 'cursor' | 'chatgpt' | 'copilot'
```

在 `register_status` 的 input 中可选传入 `agent_tool` 字段。

### Schema 迁移预留

`schema.ts` 使用 `PRAGMA user_version` 控制版本。新增字段时：

```typescript
if (currentVersion < 2) {
  db.exec('ALTER TABLE sessions ADD COLUMN agent_tool TEXT')
  db.pragma('user_version = 2')
}
```
