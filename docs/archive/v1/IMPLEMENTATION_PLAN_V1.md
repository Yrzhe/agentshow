# AgentShow — 实施计划

> 从 Pagefly 演进而来。Session 分享是入口，Agent 协作基础设施是方向。

**域名候选**: agentshow.io / agentshow.ink
**日期**: 2026-04-02

---

## 产品演进路径

```
阶段 1: 本地 MCP Server（解决自己的多 agent 协作）
    ↓
阶段 2: 云端同步 + Session 分享（解决跨机器 + 对外展示）
    ↓
阶段 3: 跨用户 Agent 协作（解决不同人的 agent 互通）
```

---

## 阶段 1: 本地 MCP Server

### 目标

让同一台电脑上的多个 Claude Code Session 互相感知、共享知识、避免重复劳动。

### 核心架构

```
你的电脑
├── Project: pagefly/
│   ├── .agentshow.json              ← 项目身份文件
│   ├── Session A (Worker) ──┐
│   └── Session B (CLI)    ──┤
│                            ├── 同 project: 完整互通
├── Project: blog/           │
│   ├── .agentshow.json      │
│   └── Session C (写文章) ──┤── 跨 project: 仅摘要
│                            │
└── Project: trading-bot/    │
    ├── .agentshow.json      │
    ├── Session D (策略) ────┤
    └── Session E (回测) ────┘
                             │
              AgentShow MCP Server (本地)
              ~/.agentshow/agentshow.db
```

### 进程模型

Claude Code 的 MCP 为每个 session 各自启动一个 server 进程：

```
Session A → agentshow-mcp 进程 1 ─┐
Session B → agentshow-mcp 进程 2 ──┼── 读写同一个 SQLite（WAL 模式）
Session C → agentshow-mcp 进程 3 ─┘
```

- 每个进程启动时生成 session_id，注册到 db
- 进程退出时通过 `process.on('exit')` 清理，标记 inactive
- SQLite WAL 模式处理并发读写，此量级完全没问题

---

### Project 识别机制

#### 核心设计：`.agentshow.json` 标记文件

项目身份锚在项目目录里，跟着项目走，不依赖中央注册表。

```json
// ~/code/pagefly/.agentshow.json
{
  "id": "proj_a7x9k2",
  "name": "pagefly"
}
```

类比 `.git`、`.vscode`、`.claude` —— 身份信息存在项目根目录。

#### 识别流程

```
Session 启动，agent 传入 cwd（如 ~/code/pagefly/src/worker/）

Step 1: 从 cwd 往上逐级查找 .agentshow.json
  → 找到了（如 ~/code/pagefly/.agentshow.json）
  → 读取 id 和 name → 完成 ✅

Step 2: 没找到 .agentshow.json
  → 确定项目根目录：
    a. 从 cwd 往上找 .git → git 根目录 = 项目根
    b. 没有 .git → cwd 本身 = 项目根
  → 在项目根目录自动创建 .agentshow.json
    - id: 自动生成 nanoid
    - name: 从目录名 / package.json name / git remote 推导
  → 返回新创建的 project 信息 ✅
```

#### .gitignore 处理

创建 `.agentshow.json` 时自动检查：
- `.gitignore` 存在且未包含 `.agentshow.json` → 自动追加一行
- `.gitignore` 不存在 → 不管（用户自行决定）
- 注意：提交到 git 也没问题 — 团队成员 clone 后自动共享同一个 project ID，为未来跨用户协作做准备

#### 各场景表现

| 场景 | 行为 | 结果 |
|------|------|------|
| 正常使用 | 找到 `.agentshow.json` | 直接使用 ✅ |
| 从子目录打开 | 往上查找到项目根 | 同一个 project ✅ |
| 文件夹改名/移动 | `.agentshow.json` 跟着走 | 数据无缝衔接 ✅ |
| 换电脑 / 同步盘 | 文件跟着同步 | 自动识别 ✅ |
| git clone 到新机器 | `.agentshow.json` 随 repo clone | 自动识别 ✅ |
| 同名不同项目 | 各自有不同的 `.agentshow.json` id | 不会冲突 ✅ |
| 全新项目（首次） | 自动创建 `.agentshow.json` | 零配置 ✅ |

#### 身份与存储的关系

```
.agentshow.json     = 身份证（跟着项目走，是 project 身份的唯一来源）
~/.agentshow/db     = 记忆（存 sessions、notes、history，用 project_id 索引）
```

db 里的 `project_id` 指向 `.agentshow.json` 里的 `id`。db 是索引和存储，不是身份来源。

---

### 隔离规则

| 关系 | 可见性 |
|------|--------|
| 同 project 内 | 完整信息：任务、文件、notes |
| 跨 project | 仅摘要："{project} 有 N 个活跃 session" |
| 跨 project 主动查询 | 可读取详细内容（需显式传 project 参数） |

---

### MCP Tools 设计

#### Tool 1: `register_status` — 注册/更新当前 session 状态

```typescript
// 输入
register_status({
  cwd: "/Users/yrzhe/code/pagefly",   // agent 的工作目录
  task: "正在做 Worker 路由层",         // 当前任务描述
  files: ["src/worker.ts", "src/router.ts"]  // 可选：正在操作的文件
})

// 返回
{
  session_id: "ses_k8m2x",
  project_id: "proj_a7x9k2",
  project_name: "pagefly",
  status: "registered"
}
```

**行为**：
- 首次调用：从 cwd 识别 project（查找 `.agentshow.json`），生成 session_id，写入 db
- 后续调用：更新 task/files，同时更新 `last_heartbeat`
- cwd 只需首次传入，后续可省略

#### Tool 2: `get_peers` — 查看其他 agent 在做什么

```typescript
// 默认：同 project 的活跃 session（排除自己）
get_peers()
// → {
//   project: "pagefly",
//   peers: [
//     { session_id: "ses_xyz", task: "在写 CLI push 命令",
//       files: ["cli/push.ts"],
//       started_at: "2026-04-02T14:00:00Z",
//       last_heartbeat: "2026-04-02T14:20:00Z" }
//   ],
//   notes_count: 3  // 该项目有 3 条未读 notes
// }

// 全局摘要：所有 project 的活跃情况
get_peers({ scope: "all" })
// → {
//   projects: [
//     { project_id: "proj_a7x9k2", name: "pagefly", active_sessions: 2, notes_count: 3 },
//     { project_id: "proj_b3n5m1", name: "blog", active_sessions: 1, notes_count: 0 },
//     { project_id: "proj_c9p4q7", name: "trading-bot", active_sessions: 2, notes_count: 5 }
//   ]
// }

// 跨 project 详细查询
get_peers({ project: "trading-bot" })
// → 返回该 project 的完整 peers 信息 + notes
```

#### Tool 3: `share_note` / `get_notes` / `delete_note` — 共享知识管理

```typescript
// 写入/更新 note（同 key 重复调用 = upsert 更新）
share_note({
  key: "d1-schema-change",
  content: "sessions 表加了 view_count 字段，类型 INTEGER DEFAULT 0"
})
// → { id: 1, key: "d1-schema-change", status: "created" }
// 或 → { id: 1, key: "d1-schema-change", status: "updated" }

// 读取 notes
get_notes()                              // 同 project 的所有 notes
get_notes({ project: "trading-bot" })    // 跨 project 读取
get_notes({ since: "2026-04-02" })       // 按时间过滤
get_notes({ search: "schema" })          // 按关键词搜索（key + content）
// → {
//   project: "pagefly",
//   notes: [
//     { id: 1, key: "d1-schema-change", content: "...",
//       session_id: "ses_xyz", created_at: "2026-04-02T14:15:00Z" }
//   ]
// }

// 删除 note
delete_note({ key: "d1-schema-change" })
// → { status: "deleted" }
```

#### Tool 4: `get_project_history` — 查看历史

```typescript
get_project_history()                                    // 当前 project 的历史
get_project_history({ project: "pagefly" })              // 指定 project
get_project_history({ since: "2026-03-01" })             // 按时间过滤
get_project_history({ search: "schema" })                // 搜索历史 notes
// → {
//   project: "pagefly",
//   sessions: [
//     { id: "ses_old1", task: "初始化项目结构",
//       started_at: "2026-04-01T10:00:00Z",
//       ended_at: "2026-04-01T12:00:00Z",
//       summary: "创建了 Worker 骨架和 D1 schema" }
//   ],
//   notes: [
//     { key: "d1-schema-v1", content: "初版 schema 设计...",
//       created_at: "2026-04-01T11:00:00Z" }
//   ]
// }
```

---

### Agent 引导（半自动模式）

不强制 agent 调用 tool，而是通过 CLAUDE.md 引导：

```markdown
# 项目根目录的 CLAUDE.md 中加入：

## AgentShow 协作
- 开始新任务时，调用 agentshow.register_status 汇报你在做什么
- 遇到重要发现或决策变更时，调用 agentshow.share_note 共享给其他 session
- 开始工作前，调用 agentshow.get_peers 看看有没有其他 session 在做相关的事
```

---

### 数据存储

#### 文件结构

```
~/.agentshow/
└── agentshow.db              # SQLite 数据库（WAL 模式）

~/code/pagefly/
└── .agentshow.json           # 项目身份文件

~/code/blog/
└── .agentshow.json           # 项目身份文件
```

#### Schema

```sql
-- 活跃 session
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,              -- nanoid，如 "ses_k8m2x"
    project_id TEXT NOT NULL,         -- 对应 .agentshow.json 中的 id
    project_name TEXT NOT NULL,       -- 冗余存储，方便查询
    cwd TEXT NOT NULL,                -- 完整工作目录
    task TEXT,                        -- 当前任务描述
    files TEXT,                       -- JSON array: 操作中的文件
    conversation_path TEXT,           -- Claude Code 对话文件路径（.jsonl）
    status TEXT DEFAULT 'active',     -- active | inactive
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_heartbeat DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 共享笔记（长期保留，同 project + key 唯一）
CREATE TABLE notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    session_id TEXT,                  -- 谁写的
    key TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, key)          -- 同 project 下 key 唯一，支持 upsert
);

-- session 历史摘要（自动归档）
CREATE TABLE session_history (
    id TEXT PRIMARY KEY,              -- 复用 session id
    project_id TEXT NOT NULL,
    project_name TEXT NOT NULL,
    task TEXT,
    summary TEXT,                     -- session 结束时生成
    conversation_path TEXT,           -- 保留对话文件路径，方便回溯
    started_at DATETIME,
    ended_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 索引
CREATE INDEX idx_sessions_project ON sessions(project_id, status);
CREATE INDEX idx_notes_project ON notes(project_id);
CREATE INDEX idx_history_project ON session_history(project_id, ended_at);
```

---

### 对话文件关联

#### Claude Code 对话文件结构

Claude Code 将每个 session 的完整对话存储为本地 JSONL 文件：

```
~/.claude/projects/{project-path-slug}/
├── {session-id}.jsonl          ← 完整对话记录（JSONL 格式）
└── {session-id}/               ← session 相关的临时文件
```

例如当前对话：
```
~/.claude/projects/-Users-renzheyu-...-pagefly/
└── 4d039db4-4465-44f9-8cd7-1c02c96fd2a5.jsonl
```

每行 JSONL 包含：`role`、`content`、`timestamp`、`cwd`、`sessionId`、tool 调用和结果等。

#### 路径推导规则

```typescript
// Claude Code 的路径命名规则：
// cwd 中的 / 替换为 -，开头加 -
function getConversationPath(cwd: string, sessionId: string): string {
  const projectSlug = cwd.replaceAll('/', '-')
  return path.join(
    os.homedir(),
    '.claude',
    'projects',
    projectSlug,
    `${sessionId}.jsonl`
  )
}
```

MCP Server 在 `register_status` 时自动推导路径并写入 `conversation_path` 字段。

#### 用途

| 用途 | 说明 |
|------|------|
| **Peer 深度了解** | `get_peers` 时可选返回对方对话的最近 N 条消息摘要，不只是 task 描述 |
| **自动生成 summary** | session 结束时读取对话文件，生成结构化摘要写入 session_history |
| **云端上传源文件** | 阶段 2 的 Session 分享直接使用此文件，无需额外导出 |
| **历史回溯** | 任何时候都能通过 `get_project_history` 找到原始对话文件 |

---

### 生命周期管理

| 事件 | 自动行为 |
|------|---------|
| MCP 进程启动 | 等待 `register_status` 调用 |
| 首次 `register_status` | 识别 project（查找 `.agentshow.json`），创建 session 记录 |
| 后续 `register_status` | 更新 task/files + last_heartbeat |
| 任意 tool 调用 | 更新 last_heartbeat（保持活跃信号） |
| MCP 进程退出 | `process.on('exit')`: 标记 inactive，写入 session_history |
| 心跳超时 5min | 其他进程查询时自动将超时 session 标记 inactive（惰性清理） |
| Notes | 永不自动删除（用户可手动 delete_note） |
| Session 历史 | 默认永久保留（数据量极小） |
| `.agentshow.json` 删除 | db 中旧数据变成孤儿，不影响其他功能 |

---

### 存储估算

- 每个 session 记录 ~1KB
- 每条 note ~0.5KB
- 每天 10 个 session + 5 条 note = ~12KB/天
- 一年 ≈ 4.3MB
- 10 年数据 < 50MB
- **完全不需要担心存储**

---

### 技术栈

| 组件 | 技术 | 说明 |
|------|------|------|
| MCP Server | TypeScript | Claude Code 原生支持 |
| 数据库 | better-sqlite3 | 单文件、无服务、WAL 模式支持并发 |
| ID 生成 | nanoid | 短且唯一，带前缀（proj_、ses_） |
| 传输 | stdio | 本地 MCP 标准方式 |

---

### Claude Code 配置

用户只需在 `~/.claude/settings.json` 中添加：

```json
{
  "mcpServers": {
    "agentshow": {
      "command": "node",
      "args": ["/path/to/agentshow-mcp/dist/index.js"]
    }
  }
}
```

所有 Claude Code session 自动连接，零配置。每个 session 的 project 归属由 `.agentshow.json` 自动决定。

---

## 阶段 2: 云端同步 + Session 分享

### 目标

本地 MCP Server 的数据同步到 AgentShow 云端，实现：
- 跨机器的 agent 协作
- Session 工作成果的公开分享（原 Pagefly 功能）
- 机器可读 API

### 架构

```
本地 MCP Server ──同步──→ AgentShow Cloud (Cloudflare)
                          ├── Workers (API + SSR)
                          ├── R2 (原始文件存储)
                          ├── D1 (元数据)
                          └── KV (页面缓存)
```

### 云端功能（继承自原 Pagefly 设计）

- `username.agentshow.io` 用户主页
- Session 对话式渲染（主题系统）
- GitHub OAuth 认证
- Unlisted 模式（知道链接才能访问）
- OG Card / Twitter Card 预览
- "Powered by AgentShow" 品牌水印
- 机器可读 API
- 浏览量统计

### CLI 工具

```bash
agentshow login              # GitHub OAuth
agentshow push               # 上传 session 到云端
agentshow list               # 列出云端项目
agentshow sync               # 本地 MCP 数据 → 云端
```

### 定价（沿用原设计，调整后）

**Free**:
- 3 个 Project，每 Project 5 个 Session
- 单文件 1MB，总存储 20MB
- 公开 + Unlisted
- 基础主题

**Pro ($8/月)**:
- 无限 Project 和 Session
- 单文件 20MB，总存储 5GB
- 密码保护
- 全部主题 + 自定义 CSS
- 嵌入式 Widget
- 浏览统计

### 技术栈

| 组件 | 技术 |
|------|------|
| DNS | Cloudflare DNS |
| 计算 | Cloudflare Workers |
| 存储 | Cloudflare R2 |
| 数据库 | Cloudflare D1 |
| 缓存 | Cloudflare KV |
| 认证 | GitHub OAuth + JWT |
| Markdown 解析 | markdown-it |
| 主题 | CSS 变量 |

---

## 阶段 3: 跨用户 Agent 协作

### 目标

不同人的 Agent 通过 AgentShow 云端交换工作成果。

### 关键新增

- **发现机制** — Agent 能搜索/找到相关的其他人的 Session
- **MCP Server 云端版** — Agent 通过 MCP 直接读取他人公开的 Session
- **协作评论** — 在 Session 步骤上留言
- **Agent 自动脱敏** — 上传时识别和遮盖敏感信息

### 这一阶段暂不详细设计，等阶段 1-2 验证后再展开。

---

## 对标参考

| 对标 | 学什么 | 来源 |
|------|--------|------|
| **Scribe** ($13 亿) | 动作结构（自动记录过程→可分享文档）、增长飞轮、定价 | 五重过滤法通过 |
| **Loom** ($1.5 亿 ARR) | 每次分享=获客、Creator 收费模型、企业路径 | 精神对标 |
| **Tango** | 定价分层（Free/Pro/Team）、功能限制策略 | 辅助参考 |

---

## 核心风险

| 风险 | 缓解策略 |
|------|---------|
| Claude Code 出原生分享/协作 | 尽快支持多格式（Cursor/ChatGPT），成为聚合层 |
| 分享动机未验证 | 阶段 1 先解决自己的痛点，不依赖他人分享意愿 |
| Agent 间协作场景太早期 | 本地 MCP 成本极低，即使市场没起来也没损失 |
| Solo developer 精力 | 严格分阶段，阶段 1 代码量很小 |

---

## 关键洞察（来自五个分析 Agent 的共识）

1. **Session 分享是入口，不是终点** — 真正方向是 Agent 协作基础设施
2. **先解决自己的痛点** — 多 agent 互不知情是真实且高频的痛
3. **教学展示是最强传播场景** — "你怎么教 AI 做这个的？"
4. **Loom 类比机制成立但频率未验证** — 需要市场数据
5. **渲染的核心是解析，不是 CSS** — 统一 schema 是技术护城河
6. **Scribe 验证了"过程可分享"值 $13 亿** — 方向已被验证
7. **发现机制是 API 的前提** — 有 API 但没人知道去哪找 = 零价值

---

## 实施状态

| 阶段 | 状态 | 备注 |
|------|------|------|
| 产品设计 | ✅ 完成 | `docs/PRODUCT_DESIGN.md` |
| 多维度分析 | ✅ 完成 | `docs/analysis-*.md` (5 份) |
| 实施计划 | 📝 本文档 | 待细化后开始开发 |
| 阶段 1 开发 | ⬜ 未开始 | 本地 MCP Server |
| 阶段 2 开发 | ⬜ 未开始 | 云端平台 |
| 阶段 3 设计 | ⬜ 未开始 | 等阶段 1-2 验证 |
