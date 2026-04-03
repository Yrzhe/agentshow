# AgentShow v2 — Daemon + Skill 实现计划

> 日期: 2026-04-03
> 状态: Step 1 + Step 2 已完成 (2026-04-03)

## Context

AgentShow v1 (MCP Server) 已完成，提供 6 个工具 + SQLite + 27 个测试。
v2 方向：从"Agent 主动调用 MCP"演进为"Daemon 自动监控 + Skill 轻量交互"。

本计划覆盖 **Step 1 (Daemon MVP)** 和 **Step 2 (Skill)**。Cloud (Step 3) 不在本次范围。

---

## 架构总览

```
~/.claude/sessions/{pid}.json     ← Daemon 监控（session 发现）
~/.claude/projects/{slug}/*.jsonl ← Daemon 监控（对话解析）
         ↓
   ┌─────────────┐
   │  Daemon      │  后台 Node.js 进程，5s 轮询
   │  SQLite DB   │  ~/.agentshow/agentshow.db（与 MCP 共享，WAL 模式）
   │  HTTP API    │  localhost:45677
   └──────┬──────┘
          │ curl
   ┌──────┴──────┐
   │  Skill       │  ~/.claude/skills/agentshow/SKILL.md
   │  /peers etc  │  Claude Code 内交互
   └─────────────┘
```

---

## Step 1: Daemon MVP — 10 个模块

### 模块 1: Package 脚手架 + Shared 类型扩展
**状态**: Complete

**目标**: 建立 daemon 包结构，扩展 shared 类型和常量。

**修改文件**:
- `packages/shared/src/types.ts` — 新增 daemon 类型
- `packages/shared/src/constants.ts` — 新增 daemon 常量
- `packages/daemon/package.json` — 新建
- `packages/daemon/tsconfig.json` — 新建
- `packages/daemon/vitest.config.ts` — 新建
- `packages/daemon/src/index.ts` — 占位入口

**新增类型** (shared):
```typescript
// Claude Code 原生 session 元数据 (~/.claude/sessions/{pid}.json)
export interface ClaudeSessionMeta {
  pid: number
  sessionId: string
  cwd: string
  startedAt: number
  kind: string
  entrypoint: string
  name?: string
}

// JSONL 对话事件
export interface ConversationEvent {
  type: string  // user | assistant | permission-mode | file-history-snapshot | ...
  uuid?: string
  parentUuid?: string | null
  timestamp?: string
  sessionId?: string
  cwd?: string
  version?: string
  gitBranch?: string
  message?: { role?: string; content?: unknown; usage?: TokenUsage; model?: string }
}

export interface TokenUsage {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
}

// Daemon 追踪的 session
export interface DaemonSession {
  session_id: string
  pid: number
  cwd: string
  project_slug: string
  status: 'discovered' | 'active' | 'ended'
  started_at: string
  last_seen_at: string
  conversation_path: string | null
  message_count: number
  total_input_tokens: number
  total_output_tokens: number
  tool_calls: number
}

// 对话事件记录
export interface MessageRecord {
  id: number
  session_id: string
  type: string
  role: string | null
  content_preview: string | null
  tool_name: string | null
  input_tokens: number
  output_tokens: number
  model: string | null
  timestamp: string
}
```

**新增常量** (shared):
```typescript
export const CLAUDE_SESSIONS_DIR = 'sessions'
export const CLAUDE_PROJECTS_DIR = 'projects'
export const DAEMON_POLL_INTERVAL_MS = 5_000
export const PID_CHECK_INTERVAL_MS = 30_000
export const DAEMON_HTTP_PORT = 45677
```

**测试**: `pnpm build` 全包通过。
**预估**: ~110 LOC

---

### 模块 2: Session 发现 + Slug 转换
**状态**: Complete

**目标**: 扫描 `~/.claude/sessions/*.json`，解析 session 元数据，转换 cwd → project slug。

**新建文件**:
- `packages/daemon/src/discovery/session-scanner.ts` (~80 LOC)
- `packages/daemon/src/discovery/slug.ts` (~20 LOC)
- `packages/daemon/tests/session-scanner.test.ts` (~100 LOC)

**关键逻辑**:
- `scanSessions(claudeDir)` → 读取 `{claudeDir}/sessions/*.json`，过滤掉 `.tmp` 文件
- `cwdToSlug(cwd)` → 将路径转为 Claude Code 风格的 slug
  - 验证: `/Users/renzheyu/Downloads/Manual Library/项目/pagefly` → `-Users-renzheyu-Downloads-Manual-Library----pagefly`

**测试**: 用临时目录放 mock `{pid}.json` 文件，验证 scanner 返回正确结构。Slug 转换用真实路径验证。

---

### 模块 3: PID 存活检查
**状态**: Complete

**目标**: 判断进程是否还在运行。

**新建文件**:
- `packages/daemon/src/discovery/pid-check.ts` (~25 LOC)
- `packages/daemon/tests/pid-check.test.ts` (~40 LOC)

**实现**: `process.kill(pid, 0)` + try/catch
**测试**: `isPidAlive(process.pid)` → true, `isPidAlive(999999)` → false

---

### 模块 4: JSONL 增量读取器
**状态**: Complete

**目标**: 从指定 byte offset 开始读取 JSONL 文件，只解析新增行。

**新建文件**:
- `packages/daemon/src/parser/jsonl-reader.ts` (~100 LOC)
- `packages/daemon/tests/jsonl-reader.test.ts` (~150 LOC)

**接口**:
```typescript
class JsonlReader {
  readNewEvents(filePath: string): { events: ConversationEvent[]; newOffset: number }
  getOffset(filePath: string): number
  setOffset(filePath: string, offset: number): void
}
```

**关键点**:
- 用 `fs.openSync` + `fs.readSync` 从 offset 位置读
- 只解析完整行（以 `\n` 结尾），保留末尾不完整行给下次
- 跳过 JSON 解析失败的行

**测试**: 创建临时 JSONL，分批写入，验证增量读取 + offset 追踪 + 容错。

---

### 模块 5: 事件提取器
**状态**: Complete

**目标**: 从 `ConversationEvent` 提取结构化数据（token、工具调用、内容摘要）。

**新建文件**:
- `packages/daemon/src/parser/event-extractor.ts` (~120 LOC)
- `packages/daemon/tests/event-extractor.test.ts` (~120 LOC)

**逻辑**:
- `assistant` 类型 → 提取 `message.usage` (tokens)，扫描 `message.content` 数组找 `tool_use`
- `user` 类型 → 提取内容前 200 字符作为 preview
- 其他类型 → type + timestamp

**测试**: 用真实 JSONL 格式的 fixture 数据测试各种 event 类型。

---

### 模块 6: Daemon 数据库
**状态**: Complete

**目标**: 在共享 SQLite 中添加 daemon 专属表（不影响 MCP 现有表）。

**新建文件**:
- `packages/daemon/src/db/connection.ts` (~30 LOC)
- `packages/daemon/src/db/schema.ts` (~80 LOC)
- `packages/daemon/src/db/queries.ts` (~200 LOC)
- `packages/daemon/tests/db.test.ts` (~250 LOC)

**修改文件**:
- `packages/mcp/src/db/schema.ts` — 将 `currentVersion > SCHEMA_VERSION` 的 throw 改为 warn（容忍高版本）

**新表** (用 `CREATE TABLE IF NOT EXISTS`，不改 user_version):
```sql
CREATE TABLE IF NOT EXISTS daemon_sessions (
    session_id TEXT PRIMARY KEY,
    pid INTEGER NOT NULL,
    cwd TEXT NOT NULL,
    project_slug TEXT NOT NULL,
    status TEXT DEFAULT 'discovered',
    started_at DATETIME NOT NULL,
    last_seen_at DATETIME NOT NULL,
    conversation_path TEXT,
    message_count INTEGER DEFAULT 0,
    total_input_tokens INTEGER DEFAULT 0,
    total_output_tokens INTEGER DEFAULT 0,
    tool_calls INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS conversation_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    type TEXT NOT NULL,
    role TEXT,
    content_preview TEXT,
    tool_name TEXT,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    model TEXT,
    timestamp DATETIME,
    FOREIGN KEY (session_id) REFERENCES daemon_sessions(session_id)
);

CREATE TABLE IF NOT EXISTS file_offsets (
    file_path TEXT PRIMARY KEY,
    byte_offset INTEGER DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_daemon_sessions_status ON daemon_sessions(status);
CREATE INDEX IF NOT EXISTS idx_daemon_sessions_slug ON daemon_sessions(project_slug);
CREATE INDEX IF NOT EXISTS idx_events_session ON conversation_events(session_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_events_type ON conversation_events(type);
```

**Queries**:
- `upsertDaemonSession` / `updateSessionStatus` / `updateSessionStats`
- `getDaemonSessionsByStatus` / `getAllDaemonSessions`
- `insertConversationEvents` (batch)
- `getFileOffset` / `setFileOffset`
- `getSessionEvents` / `getSessionStats`

**测试**: 复用 MCP 的 temp DB 模式，测试所有 CRUD。

---

### 模块 7: Session Tracker（核心调度）
**状态**: Complete

**目标**: 组合模块 2-6，实现主循环。

**新建文件**:
- `packages/daemon/src/tracker/session-tracker.ts` (~200 LOC)
- `packages/daemon/tests/session-tracker.test.ts` (~250 LOC)

**每 5s 一个 tick**:
```
1. scanSessions() → 发现新 session
2. 新 session → INSERT daemon_sessions (status=discovered)
3. 找到对应 JSONL → status=active
4. 活跃 session:
   a. 每 30s 检查 PID 存活
   b. PID 死亡 → status=ended
   c. PID 存活 → readNewEvents → extractData → 写入 DB
5. session JSON 文件消失 → status=ended
```

**测试**: 集成测试，创建模拟 `~/.claude` 目录结构，运行 tick()，验证 DB 状态变化。

---

### 模块 8: HTTP API
**状态**: Complete

**目标**: localhost:45677 提供 REST API 给 Skill 查询。

**新建文件**:
- `packages/daemon/src/api/server.ts` (~80 LOC)
- `packages/daemon/src/api/routes.ts` (~180 LOC)
- `packages/daemon/tests/api.test.ts` (~200 LOC)

**端点**:
```
GET  /health                → { status, uptime }
GET  /sessions              → { sessions: DaemonSession[] }
GET  /sessions/:id          → { session, recent_events }
GET  /sessions/:id/stats    → { input_tokens, output_tokens, tool_calls }
GET  /projects              → { projects: [{ slug, active_sessions, total_tokens }] }
```

**技术**: Node.js 原生 `http.createServer`，绑定 `127.0.0.1`，JSON-only。

**测试**: 启动 server 在随机端口，用 fetch 测试各端点返回。

---

### 模块 9: 入口 + 进程管理
**状态**: Complete

**目标**: 串联所有模块，作为长驻进程运行。

**修改文件**:
- `packages/daemon/src/index.ts` (~50 LOC)

```typescript
const db = getDb()
const tracker = new SessionTracker(db, claudeDir)
const server = createApiServer(db, port)
tracker.start()
server.listen()
// SIGTERM/SIGINT → graceful shutdown
```

**测试**: 冒烟测试 — 启动 daemon，curl /health，停止。

---

### 模块 10: launchd 集成
**状态**: Complete

**目标**: macOS 开机自启。

**新建文件**:
- `packages/daemon/scripts/install.sh` (~40 LOC)
- `packages/daemon/scripts/uninstall.sh` (~15 LOC)
- `packages/daemon/com.agentshow.daemon.plist` (~25 LOC)

**测试**: 手动验证。

---

## Step 2: Skill

### 模块 11: Claude Code Skill
**状态**: Complete

**目标**: 在 Claude Code 内通过 /peers 等命令查询 daemon。

**新建文件**:
- `packages/skill/SKILL.md` (~80 LOC)
- `packages/skill/scripts/install.sh` (~15 LOC)

**SKILL.md 结构**:
```yaml
---
name: agentshow
description: See what your AI agent sessions are doing. View active sessions, token usage, and history. Use when asked about peers, active sessions, or agent activity.
---
```

**命令**: /peers, /notes, /note, /history, /stats — 都通过 `curl localhost:45677/...`

**测试**: 安装 skill，启动 Claude Code，手动验证命令触发。

---

## 实现顺序 & 依赖

```
模块 1 (脚手架)
  ├→ 模块 2 (Session 发现)  ─┐
  ├→ 模块 3 (PID 检查)      ├→ 可并行开发
  ├→ 模块 4 (JSONL 读取)    │
  ├→ 模块 5 (事件提取)      ─┘
  └→ 模块 6 (数据库)
         └→ 模块 7 (Session Tracker) ← 依赖 2,3,4,5,6
              ├→ 模块 8 (HTTP API) ← 依赖 6
              └→ 模块 9 (入口) ← 依赖 7,8
                   └→ 模块 10 (launchd)
                        └→ 模块 11 (Skill) ← 依赖 daemon 运行
```

---

## 测试策略总览

| 模块 | 测试类型 | 测试文件 | 预估测试数 |
|------|---------|---------|-----------|
| 2 Session Scanner | Unit | session-scanner.test.ts | 5-6 |
| 3 PID Check | Unit | pid-check.test.ts | 3-4 |
| 4 JSONL Reader | Unit | jsonl-reader.test.ts | 6-8 |
| 5 Event Extractor | Unit | event-extractor.test.ts | 5-7 |
| 6 Database | Unit+Integration | db.test.ts | 8-10 |
| 7 Session Tracker | Integration | session-tracker.test.ts | 6-8 |
| 8 HTTP API | Integration | api.test.ts | 8-10 |
| **合计** | | | **~45-55** |

**测试框架**: Vitest (globals=true)，复用 MCP 的 temp DB 模式。

---

## 关键风险 & 对策

| 风险 | 对策 |
|------|------|
| Slug 算法不准确 | 用机器上的真实路径对照验证 |
| Schema 冲突 | daemon 用 `CREATE TABLE IF NOT EXISTS`，不改 user_version |
| 并发 DB 写入 | WAL 模式已启用，better-sqlite3 处理良好 |
| JSONL 读到半行 | 只解析完整行，缓存末尾不完整部分 |
| MCP schema.ts 的 version 检查 | 改 throw 为 warn，容忍高版本 |

---

## 验收标准（E2E）

1. `pnpm build` 全部成功
2. `pnpm test` 通过所有测试（MCP 27 + Daemon ~50 = ~77）
3. `node packages/daemon/dist/index.js` 启动成功
4. 开一个 Claude Code session
5. `curl localhost:45677/sessions` 能看到该 session
6. 在 Claude Code 中对话几轮
7. `curl localhost:45677/sessions/{id}/stats` 显示 token 消耗 > 0
8. 关闭 Claude Code session
9. `curl localhost:45677/sessions` 显示 session status=ended
10. 安装 Skill，新开 Claude Code，/peers 正常工作

---

## 预估代码量

| 部分 | 源码 | 测试 | 合计 |
|------|------|------|------|
| Shared 扩展 | ~50 | — | 50 |
| Daemon 源码 | ~1,000 | ~1,100 | 2,100 |
| Skill | ~100 | — | 100 |
| 脚本 | ~80 | — | 80 |
| **合计** | **~1,230** | **~1,100** | **~2,330** |

---

## 目录结构预览

```
packages/daemon/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── com.agentshow.daemon.plist
├── scripts/
│   ├── install.sh
│   └── uninstall.sh
├── src/
│   ├── index.ts
│   ├── discovery/
│   │   ├── session-scanner.ts
│   │   ├── slug.ts
│   │   └── pid-check.ts
│   ├── parser/
│   │   ├── jsonl-reader.ts
│   │   └── event-extractor.ts
│   ├── db/
│   │   ├── connection.ts
│   │   ├── schema.ts
│   │   └── queries.ts
│   ├── tracker/
│   │   └── session-tracker.ts
│   └── api/
│       ├── server.ts
│       └── routes.ts
└── tests/
    ├── session-scanner.test.ts
    ├── pid-check.test.ts
    ├── jsonl-reader.test.ts
    ├── event-extractor.test.ts
    ├── db.test.ts
    ├── session-tracker.test.ts
    └── api.test.ts

packages/skill/
├── SKILL.md
├── scripts/
│   └── install.sh
└── README.md
```
