# Feature: Node.js + SQLite + Docker 迁移

> 日期: 2026-04-04
> 状态: Phase 0-2 已完成 (2026-04-04), Phase 3 待验证
> 前置: MCP Bridge (Step 3.5) 已完成

## Overview

将 AgentShow 后端从 Cloudflare Workers + D1 迁移为 Node.js + better-sqlite3，Docker 容器化，支持一键部署到任意 VPS。

**核心原则**：
- Node.js + SQLite 为主线
- Workers 降级为可选部署方案（不删除，不再双主线维护）
- 本地 `docker compose up` = 生产环境
- 镜像拉取即部署

---

## 当前架构 vs 目标架构

```
当前:
  Daemon (Node.js) → HTTPS POST → Cloudflare Worker (Hono) → D1 (SQLite-like)

目标:
  Daemon (Node.js) → HTTP POST → Server (Hono + @hono/node-server) → SQLite (better-sqlite3)
                                      ↑
                                  Docker 容器
                                  Port 3000
                                  Volume: /data/agentshow.db
```

---

## Cloudflare 特有依赖分析

| 依赖 | 出现位置 | 迁移方案 |
|------|---------|---------|
| `D1Database` (async API) | db/queries.ts, auth.ts (47处) | → better-sqlite3 (sync API) |
| `env.AI` (Workers AI) | summary.ts | → Anthropic SDK / 可配置 LLM |
| `wrangler.toml` bindings | index.ts (Bindings type) | → process.env + .env 文件 |
| `sha256Hex` (Web Crypto) | lib/hash.ts | → Node.js crypto 模块 |
| `@cloudflare/vitest-pool-workers` | vitest test pool | → 标准 vitest |

---

## Phase 0: Bug Fix — Sync 时间格式不一致

### 问题
- Daemon 的 `last_seen_at`: `"2026-04-03 16:36:55"` (空格分隔)
- Sync watermark: `"2026-04-03T12:54:37.622Z"` (ISO T 分隔)
- 字符串比较 `' '` < `'T'`，导致 session 更新后永不重同步

### 修复
**文件**: `packages/daemon/src/sync/cloud-sync.ts`
- `handleSuccess()` 中存 watermark 时，将 `last_seen_at` 统一为 ISO 格式
- 或在 `getSessionsModifiedSince()` 中 normalize 两边格式

**文件**: `packages/daemon/src/db/queries.ts`
- `getSessionsModifiedSince()` 查询改用 `datetime()` 函数做比较：
  ```sql
  WHERE ? = '' OR datetime(last_seen_at) > datetime(?)
  ```

**测试**: 在 `packages/daemon/tests/mcp-bridge.test.ts` 或新建 `sync.test.ts` 中验证混合格式比较。

**Status**: Not Started

---

## Phase 1: 创建 `packages/server` 包

### 1A: 包结构 + DB 层
**Goal**: 建立 server 包，移植 DB 操作到 better-sqlite3

**新建文件**:
```
packages/server/
├── package.json
├── tsconfig.json
├── .env.example
├── src/
│   ├── main.ts              # @hono/node-server 入口
│   ├── app.ts               # Hono app (与 worker/index.ts 类似)
│   ├── env.ts               # process.env 读取 + 校验
│   ├── db/
│   │   ├── connection.ts     # better-sqlite3 连接 + WAL
│   │   ├── migrate.ts        # 读取 migrations/*.sql 并执行
│   │   └── queries.ts        # 从 worker 移植，async → sync
│   └── lib/
│       ├── hash.ts           # Node.js crypto.createHash
│       └── jwt.ts            # jsonwebtoken 库
```

**关键变化**:
- D1 `.prepare().bind().first()` (async) → better-sqlite3 `.prepare().get()` (sync)
- D1 `.prepare().bind().all()` (async) → better-sqlite3 `.prepare().all()` (sync)
- D1 `.prepare().bind().run()` (async) → better-sqlite3 `.prepare().run()` (sync)
- 路由 handler 保持 async（Hono 要求），但 DB 调用改 sync

**dependencies**:
```json
{
  "hono": "^4.7.0",
  "@hono/node-server": "^1.13.0",
  "better-sqlite3": "^11.0.0",
  "jsonwebtoken": "^9.0.0"
}
```

**Status**: Not Started

### 1B: 路由移植
**Goal**: 移植所有 API 路由到 server 包

**从 worker 复制并适配**:
- `api/sync.ts` — sync endpoint (核心)
- `api/sessions.ts` — sessions CRUD
- `api/projects.ts` — projects list
- `api/search.ts` — 全文搜索
- `api/notes.ts` — notes 查询
- `api/usage.ts` — 日 token 聚合
- `api/tokens.ts` — API token 管理
- `api/auth-email.ts` — 邮件登录 (Resend API)
- `api/auth-github.ts` — GitHub OAuth
- `api/summary.ts` — AI 摘要 (改用可配置 LLM)
- `middleware/auth.ts` — bearer + cookie 认证
- `dashboard/` — SPA dashboard (直接复制，无需改)

**路由签名变化**:
```typescript
// Before (Worker)
const session = await getCloudSession(c.env.DB, userId, sessionId)

// After (Server)
const session = getCloudSession(db, userId, sessionId)  // sync, db 从 app context 获取
```

**Status**: Not Started

### 1C: Migrations 复用
**Goal**: 复用 Worker 的 D1 migrations SQL

**文件**: `packages/server/migrations/` — 软链接或复制 `packages/worker/migrations/`

Migration runner (`db/migrate.ts`):
```typescript
import Database from 'better-sqlite3'
import { readdirSync, readFileSync } from 'fs'

export function runMigrations(db: Database.Database, migrationsDir: string) {
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY, applied_at TEXT DEFAULT (datetime('now'))
  )`)
  const applied = new Set(db.prepare('SELECT name FROM _migrations').all().map(r => r.name))
  const files = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()
  for (const file of files) {
    if (!applied.has(file)) {
      db.exec(readFileSync(join(migrationsDir, file), 'utf-8'))
      db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file)
    }
  }
}
```

**Status**: Not Started

### 1D: AI 摘要替换
**Goal**: 替换 Workers AI 为可配置 LLM

**方案**:
- 环境变量 `AI_PROVIDER=anthropic|openai|ollama|disabled`
- `AI_API_KEY` + `AI_MODEL`
- 默认: `anthropic` + `claude-haiku-4-5-20251001`（最便宜）
- 如果 `disabled`，摘要功能关闭

**Status**: Not Started

---

## Phase 2: Docker 容器化

### 2A: Dockerfile
```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/ packages/shared/
COPY packages/server/ packages/server/
RUN corepack enable && pnpm install --frozen-lockfile
RUN pnpm --filter @agentshow/server build

FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache sqlite
COPY --from=builder /app/packages/server/dist ./dist
COPY --from=builder /app/packages/server/package.json ./
COPY --from=builder /app/packages/server/node_modules ./node_modules
COPY --from=builder /app/packages/server/migrations ./migrations
EXPOSE 3000
VOLUME /data
ENV DATABASE_PATH=/data/agentshow.db
CMD ["node", "dist/main.js"]
```

### 2B: docker-compose.yml
```yaml
version: '3.8'
services:
  agentshow:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - agentshow-data:/data
    env_file: .env
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3

volumes:
  agentshow-data:
```

### 2C: .env.example
```bash
# Required
JWT_SECRET=change-me-to-a-random-string

# GitHub OAuth (optional, for browser login)
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# Email Login (optional, via Resend)
RESEND_API_KEY=
ALLOWED_EMAILS=user@example.com

# AI Summary (optional)
AI_PROVIDER=disabled
AI_API_KEY=
AI_MODEL=claude-haiku-4-5-20251001

# Database
DATABASE_PATH=/data/agentshow.db

# Server
PORT=3000
```

**Status**: Not Started

---

## Phase 3: 验证 + 部署文档

### 3A: 本地验证
```bash
docker compose up --build
# → http://localhost:3000 显示 dashboard
# → curl http://localhost:3000/api/health → {"status":"ok"}
# → 修改 ~/.agentshow/config.json cloud.url = http://localhost:3000
# → 等待 30s sync → sessions 出现在 dashboard
```

### 3B: VPS 部署文档
```bash
# 一键部署
git clone <repo>
cp .env.example .env
# 编辑 .env
docker compose up -d

# 配 Cloudflare DNS（可选）
# A 记录 → VPS IP
# Cloudflare Proxy → 自动 TLS
```

### 3C: Daemon config 更新
- `~/.agentshow/config.json` 的 `cloud.url` 改为 `http://localhost:3000` 或 VPS URL

**Status**: Not Started

---

## 工程师分配

### 工程师 1: Bug Fix + DB 层 (Phase 0 + 1A + 1C)
1. 修复 sync datetime 格式 bug
2. 创建 `packages/server` 包结构
3. 移植 `db/queries.ts`（D1 → better-sqlite3）
4. 实现 migration runner
5. 实现 `lib/hash.ts` + `lib/jwt.ts`（Node.js crypto）
6. 写测试验证 DB 层

### 工程师 2: 路由 + Docker (Phase 1B + 2)
1. 创建 `main.ts` + `app.ts`（@hono/node-server 入口）
2. 移植所有 API 路由（适配 sync DB 调用）
3. 移植 dashboard（直接复制）
4. 创建 Dockerfile + docker-compose.yml + .env.example
5. 移植 auth 中间件（改用 jsonwebtoken）
6. 实现 AI summary 可配置化

**并行策略**: 工程师 1 先建好 `packages/server/src/db/` 接口，工程师 2 在此基础上接路由。工程师 1 的 bug fix 和 DB 层可独立完成。

---

## 预估

| Phase | 新文件 | 修改文件 | 预估 LOC |
|-------|--------|---------|---------|
| 0: Bug Fix | 0 | 2 | ~15 |
| 1A: DB 层 | 5 | 0 | ~400 |
| 1B: 路由移植 | 15 | 0 | ~600 |
| 1C: Migrations | 1 | 0 | ~30 |
| 1D: AI 替换 | 1 | 0 | ~50 |
| 2: Docker | 3 | 0 | ~80 |
| **Total** | **25** | **2** | **~1175** |
