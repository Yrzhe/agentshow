# AgentShow Step 3 — Cloud API + Dashboard 实现计划

> 日期: 2026-04-03
> 状态: 已完成 (2026-04-03)
> 前置: Step 1 (Daemon) + Step 2 (Skill) 已完成

---

## 架构

```
用户的 Mac                          Cloudflare（用户自部署）
┌──────────┐    HTTPS POST         ┌──────────────┐
│  Daemon   │ ──────────────────→  │  Worker API   │  Hono
│  (本地)   │    每 30s 同步        │  D1 数据库    │
└──────────┘                       │  Dashboard    │  Vanilla JS SPA
                                   └──────────────┘
```

**关键原则**：
- 每个用户部署自己的 Worker + D1，无中心化后端
- 认证：GitHub OAuth（浏览器）+ API Token（VPS/headless）
- 隐私分级：0=仅本地, 1=元数据, 2=摘要, 3=完整
- 默认 Level 0，不上传任何东西

---

## 本地配置 (~/.agentshow/config.json)

```json
{
  "device_id": "dev_xxxxxxxx",
  "cloud": {
    "url": "https://agentshow.username.workers.dev",
    "token": "as_xxxxxxxxxxxxxxxxxxxxxxxxxxxx"
  },
  "privacy": {
    "level": 0
  }
}
```

---

## 隐私分级数据表

| 字段 | Level 0 | Level 1 (元数据) | Level 2 (摘要) | Level 3 (完整) |
|------|---------|-----------------|---------------|---------------|
| session 元数据 | -- | yes | yes | yes |
| cwd | -- | hash only | 明文 | 明文 |
| token 统计 | -- | yes | yes | yes |
| Events | -- | **不上传** | yes (200字摘要) | yes (完整) |
| tool_name | -- | -- | yes | yes |
| model | -- | -- | yes | yes |

---

## 7 个模块

### 模块 A: Shared 类型 + 配置系统
**状态**: Not Started
**预估**: ~230 LOC (源码 150 + 测试 80)

**修改文件**:
- `packages/shared/src/types.ts` — 新增 PrivacyLevel, AgentShowConfig, CloudConfig, SyncPayload, SyncSession, SyncEvent, SyncResponse, CloudSession, CloudProject, ApiToken
- `packages/shared/src/constants.ts` — 新增 CLOUD_SYNC_INTERVAL_MS, CONFIG_FILE, API_TOKEN_PREFIX, SYNC_BATCH_SIZE

**新建文件**:
- `packages/shared/src/config.ts` — readConfig, writeConfig, getDefaultConfig
- `packages/shared/src/privacy.ts` — shouldSync, shapeSessionForSync, shapeEventForSync
- `packages/shared/tests/config.test.ts`
- `packages/shared/tests/privacy.test.ts`

---

### 模块 B: Daemon 同步模块
**状态**: Not Started
**预估**: ~350 LOC (源码 200 + 测试 150)

**新建文件**:
- `packages/daemon/src/sync/config-loader.ts` — 读取并缓存 config.json
- `packages/daemon/src/sync/cloud-sync.ts` — CloudSync 类 (30s 间隔, 增量 POST)
- `packages/daemon/src/sync/data-shaper.ts` — 按隐私级别整形数据

**修改文件**:
- `packages/daemon/src/db/schema.ts` — 新增 sync_state 表
- `packages/daemon/src/db/queries.ts` — 新增 getSyncState, setSyncState, getSessionsModifiedSince, getEventsAfterLocalId
- `packages/daemon/src/main.ts` — 启动 CloudSync

**同步逻辑**:
1. 读 config，level=0 或缺 url/token → 跳过
2. 查 sync_state 获取上次同步位置
3. 查询新增/更新的 sessions 和 events
4. 按 privacy level 整形数据
5. POST {cloud.url}/api/sync + Bearer token
6. 成功 → 更新 sync_state；失败 → 指数退避重试

---

### 模块 C: Worker 脚手架 + D1 Schema
**状态**: Not Started
**预估**: ~200 LOC

**新建 packages/worker/**:
- package.json (hono, @cloudflare/workers-types, wrangler, vitest)
- wrangler.toml (D1 binding)
- tsconfig.json
- src/index.ts (Hono app 入口)
- migrations/0001_initial.sql

**D1 表**:
```sql
users (id PK, github_id UNIQUE, github_login, github_avatar_url, created_at)
api_tokens (id PK, user_id FK, name, token_hash UNIQUE, prefix, last_used_at, created_at)
cloud_sessions (session_id + user_id PK, device_id, pid, cwd, project_slug, status, 时间戳, 统计)
cloud_events (id PK, user_id, session_id, local_id, type, role, content_preview, tool_name, tokens, model, timestamp)
sync_watermarks (user_id + device_id PK, last_session_seen_at, last_event_local_id)
```

---

### 模块 D: Worker API 端点
**状态**: Not Started
**预估**: ~600 LOC (源码 400 + 测试 200)

**端点**:
| Method | Path | Auth | 说明 |
|--------|------|------|------|
| POST | /api/sync | Bearer token | 接收 daemon 数据 |
| GET | /api/sessions | Cookie/Bearer | Session 列表 |
| GET | /api/sessions/:id | Cookie/Bearer | Session 详情 + events |
| GET | /api/sessions/:id/stats | Cookie/Bearer | Token 统计 |
| GET | /api/projects | Cookie/Bearer | 项目列表聚合 |
| GET | /api/auth/me | Cookie/Bearer | 当前用户 |

---

### 模块 E: 认证系统
**状态**: Not Started
**预估**: ~450 LOC (源码 300 + 测试 150)

**两种认证方式**:

1. **GitHub OAuth** (浏览器 Dashboard)
   - GET /api/auth/github → 重定向 GitHub
   - GET /api/auth/github/callback → 交换 code → JWT cookie
   - 用户需创建自己的 GitHub OAuth App

2. **API Token** (Daemon/VPS)
   - Dashboard 设置页生成 token（as_ + 32 字符）
   - 存储 SHA-256 hash，明文只显示一次
   - Daemon 用 Authorization: Bearer 头

**文件**:
- src/api/auth-github.ts, src/api/tokens.ts
- src/lib/token-hash.ts, src/lib/github-oauth.ts, src/lib/jwt.ts

---

### 模块 F: Dashboard 前端
**状态**: Not Started
**预估**: ~800 LOC

**技术**: Vanilla JS SPA，无构建步骤，从 Worker 直接 serve

**页面**:
1. **Sessions** (默认) — 表格：session, 项目, 状态, 时长, tokens, 工具调用
2. **Session Detail** — 事件时间线, token 用量, 工具调用摘要
3. **Projects** — 项目卡片：活跃 session 数, 总 token, 最后活动
4. **Usage** — 日/周 token 使用图表
5. **Settings** — API token 管理, 设备列表, 账户信息
6. **Login** — GitHub OAuth 按钮

---

### 模块 G: 部署文档 + Deploy 按钮
**状态**: Not Started
**预估**: ~100 LOC

```bash
# 用户部署流程
git clone https://github.com/yrzhe/agentshow && cd agentshow
pnpm install && pnpm build
cd packages/worker
npx wrangler d1 create agentshow
npx wrangler d1 migrations apply agentshow
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put JWT_SECRET
npx wrangler deploy
```

---

## 实现顺序 & 依赖

```
模块 A (Shared 类型 + 配置)
  ├→ 模块 B (Daemon 同步) — 可独立测试
  └→ 模块 C (Worker 脚手架 + D1)
       ├→ 模块 D (API 端点)  ─┐
       └→ 模块 E (认证系统)   ├→ 可并行
                              ─┘
              └→ 模块 F (Dashboard) ← 依赖 D, E
                   └→ 模块 G (部署文档)
```

**模块 B 和 C 可并行（无依赖）。**
**模块 D 和 E 可并行（都只依赖 C）。**

---

## 预估代码量

| 模块 | 源码 | 测试 | 合计 |
|------|------|------|------|
| A: Shared 扩展 | 150 | 80 | 230 |
| B: Daemon 同步 | 200 | 150 | 350 |
| C: Worker 脚手架 | 200 | 0 | 200 |
| D: API 端点 | 400 | 200 | 600 |
| E: 认证系统 | 300 | 150 | 450 |
| F: Dashboard | 800 | 0 | 800 |
| G: 部署文档 | 100 | 0 | 100 |
| **合计** | **~2,150** | **~580** | **~2,730** |

---

## 安全考虑

- API token 存储 SHA-256 hash，不存明文
- JWT secret 是 Worker secret，不在源码中
- Daemon 同步走 HTTPS（Workers 强制 HTTPS）
- Level 1 下 cwd 做 hash 处理，不泄露文件路径
- /api/sync 做限流（10 次/分钟/token）
- CORS 只允许 Worker 自己的 origin
