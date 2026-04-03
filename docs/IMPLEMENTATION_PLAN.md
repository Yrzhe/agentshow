# AgentShow v2 — 实施计划（Daemon + Skill + Cloud 架构）

> 从 MCP Server 方案演进为：本地守护进程自动监控 + Claude Code Skill 交互 + 云端可观测性平台。
> 定位：**Agent 工作的协调与可见性层（Agent 版的 Datadog）**

**日期**: 2026-04-02

---

## 产品定位演进

```
v1（已完成）：本地 MCP Server — Agent 自助注册和查询
   ↓ 问题：需要 Agent 主动调用、需要配置 MCP、侵入性强
v2（本文档）：Daemon 自动监控 — 零配置自动采集、Skill 轻量交互、云端可观测性
```

### 一句话定位

**AgentShow = 让你看清所有 AI Agent 在干什么、花了多少钱、做了什么决定。**

不做 Agent 通信基础设施（大厂的活），做 Agent 协调与可见性层（大厂不做的活）。

---

## 核心架构

```
┌──────────────────────────────────────────────────┐
│  用户的 Mac                                        │
│                                                   │
│  Claude Code Session A ──┐                        │
│  Claude Code Session B ──┤── 正常工作，完全无感知   │
│  Claude Code Session C ──┘                        │
│                                                   │
│  ┌─────────────────────────────────────────────┐  │
│  │ AgentShow Daemon（后台常驻 Node.js 进程）     │  │
│  │                                              │  │
│  │  监控层：                                     │  │
│  │  ├── watch ~/.claude/sessions/*.json         │  │
│  │  ├── watch ~/.claude/projects/**/*.jsonl     │  │
│  │  └── 检测 session 启动/活跃/结束              │  │
│  │                                              │  │
│  │  数据层：                                     │  │
│  │  ├── 解析 JSONL 对话内容                      │  │
│  │  ├── 提取：角色、工具调用、token 消耗、时间戳  │  │
│  │  └── 增量同步到云端 API                       │  │
│  │                                              │  │
│  │  本地缓存：                                   │  │
│  │  └── ~/.agentshow/local.db (SQLite)          │  │
│  └──────────────────────────┬──────────────────┘  │
│                             │                     │
│  ┌──────────────────────────┼──────────────────┐  │
│  │ AgentShow Skill          │                  │  │
│  │ （在 Claude Code 内）     │                  │  │
│  │  ├── /peers — 查看 peers  │                  │  │
│  │  ├── /note — 共享笔记     │                  │  │
│  │  └── /history — 查历史    │                  │  │
│  └──────────────────────────┼──────────────────┘  │
└─────────────────────────────┼─────────────────────┘
                              │ HTTPS API
                              ▼
                    ┌──────────────────────┐
                    │  AgentShow Cloud     │
                    │  (Cloudflare)        │
                    │                      │
                    │  ├── 实时 Dashboard   │
                    │  ├── Session 回放    │
                    │  ├── 成本追踪        │
                    │  ├── 共享 Notes      │
                    │  └── 团队管理        │
                    └──────────────────────┘
```

---

## 三个组件的职责划分

### 1. Daemon（后台守护进程）— 数据采集 + 同步

**它做什么**：
- 开机自启，后台常驻
- 监控 `~/.claude/` 目录，自动发现所有 Claude Code session
- 解析对话内容，提取结构化数据
- 增量同步到云端 API
- 维护本地 SQLite 缓存

**它不做什么**：
- 不需要 Agent 主动调用任何东西
- 不修改 Claude Code 的行为
- 不需要 MCP 配置

**用户感知**：完全无感。装完就忘。

### 2. Skill（Claude Code 内的交互层）— Agent 主动读写

**它做什么**：
- Agent 想查看其他 session 状态时调用
- Agent 想共享笔记/决策给其他 session 时调用
- 通过云端 API 或本地 daemon 的 HTTP 接口通信

**它不做什么**：
- 不负责数据采集（daemon 做）
- 不需要注册（daemon 已经知道所有 session）

**安装方式**：把 skill 文件夹放到 `~/.claude/skills/agentshow/` 即可。

### 3. Cloud（云端平台）— 可视化 + 持久化 + 协作

**它做什么**：
- 接收 daemon 上传的 session 数据
- 提供 Web Dashboard（实时状态、历史回放、成本分析）
- 存储共享 notes
- 团队管理和权限控制
- 对外 API（其他工具集成）

**技术栈**：Cloudflare 全家桶（Workers + D1 + R2 + KV）

---

## Claude Code 本地数据结构（工程师调研结果）

### Session 元数据

```
~/.claude/sessions/{pid}.json
```

```json
{
  "pid": 39897,
  "sessionId": "4d039db4-4465-44f9-8cd7-1c02c96fd2a5",
  "cwd": "/Users/renzheyu/.../pagefly",
  "startedAt": 1775112601661,
  "kind": "interactive",
  "entrypoint": "cli"
}
```

**可提取信息**：pid（判断是否存活）、sessionId（唯一标识）、cwd（所属项目）、startedAt

### 对话记录

```
~/.claude/projects/{project-slug}/{sessionId}.jsonl
```

每行一个 JSON 事件，包含：
- `type`: user / assistant / tool_use / tool_result / permission-mode 等
- `timestamp`: ISO 8601
- `message.role`: user / assistant
- `message.content`: 对话内容
- `cwd`, `sessionId`, `gitBranch`

**写入速率**：活跃对话约 0.03-0.06 行/秒，不频繁，daemon 完全跟得上。

### Session 存活判断

- 方法 1：检查 `~/.claude/sessions/{pid}.json` 对应的 pid 是否还在运行（`kill -0 pid`）
- 方法 2：检查 JSONL 文件的最后修改时间
- 推荐组合使用

---

## 实施步骤

### Step 1：Daemon MVP（Node.js + launchd）— ✅ 已完成 (2026-04-03)

**目标**：后台进程能自动检测所有 Claude Code session，数据存到本地 SQLite。

```
packages/daemon/
├── package.json
├── src/
│   ├── index.ts              # 入口
│   ├── watcher.ts            # 文件系统监控
│   ├── parser.ts             # JSONL 解析器
│   ├── session-tracker.ts    # Session 生命周期管理
│   └── db/
│       ├── connection.ts     # SQLite（复用 v1 代码）
│       ├── schema.ts
│       └── queries.ts
├── scripts/
│   └── install-launchd.sh    # macOS launchd 安装脚本
└── com.agentshow.daemon.plist  # launchd 配置
```

**文件监控策略**：
- 用 `chokidar` 监控 `~/.claude/sessions/` 和 `~/.claude/projects/`
- 新 session 文件出现 → 开始追踪
- JSONL 变化 → 增量读取新行（记录 file offset）
- Session 文件消失 or pid 不存在 → 标记结束

**安装方式**：
```bash
# 克隆 + 构建
git clone https://github.com/Yrzhe/agentshow && cd agentshow
pnpm install && pnpm build

# 安装 daemon
./packages/daemon/scripts/install-launchd.sh
# → 创建 ~/Library/LaunchAgents/com.agentshow.daemon.plist
# → launchctl load 启动
```

**验收标准**：
- daemon 后台运行
- 开两个 Claude Code session
- SQLite 中自动出现两条 session 记录
- 关闭一个 session → 自动标记 inactive

### Step 2：Skill（Claude Code 内交互）— ✅ 已完成 (2026-04-03)

**目标**：Agent 可以通过 skill 查看 peers、共享 notes。

```
packages/skill/
├── SKILL.md                  # Skill 入口定义
├── agents/
│   └── agentshow.md          # Agent 定义
└── README.md
```

Skill 内部调用 daemon 的本地 HTTP API（daemon 起一个小型 HTTP server on localhost）或直接读 SQLite。

**Skill 命令**：
```
/peers           — 查看当前有哪些 session 在活跃
/note <key> <content>  — 共享一条笔记
/notes           — 查看所有笔记
/history         — 查看历史 session
```

**验收标准**：
- 在 Claude Code 里调用 /peers 能看到其他 session
- 调用 /note 能共享笔记，其他 session 能读到

### Step 3：云端 API + Dashboard

**目标**：daemon 的数据同步到云端，Web 上可查看。

```
packages/worker/              # Cloudflare Worker
├── src/
│   ├── index.ts              # 路由
│   ├── api/
│   │   ├── sessions.ts       # Session CRUD
│   │   ├── notes.ts          # Notes CRUD
│   │   └── auth.ts           # GitHub OAuth
│   └── render/
│       └── dashboard.ts      # SSR Dashboard
└── wrangler.toml
```

**daemon 同步协议**：
- daemon 定期（每 30 秒）POST 增量数据到云端
- 认证：用户首次 `agentshow login` 获取 JWT
- 隐私控制：用户可选上传哪些数据（元数据 / 摘要 / 完整对话）

**Dashboard 功能**：
- 实时活跃 session 列表
- Session 对话回放
- Token 消耗统计
- 共享 Notes 面板
- 历史趋势图

### Step 4：团队功能

- 团队邀请和权限
- 成员的 Agent 活动汇总
- 决策审计日志
- 成本归因

---

## 隐私和授权设计

### 分级授权（参考 VS Code telemetry + Cursor Privacy Mode）

```
Level 0 — 仅本地（默认）
  daemon 采集数据但只存本地 SQLite
  不上传任何东西到云端

Level 1 — 元数据上传
  上传：session 启动/结束时间、项目名、持续时长、工具调用次数
  不上传：对话内容、代码、prompt

Level 2 — 摘要上传
  上传：AI 生成的 session 摘要、工具调用类型统计、token 消耗
  不上传：原始对话内容、代码

Level 3 — 完整上传
  上传所有内容（用户明确选择）
```

### 授权流程

```
首次安装 daemon 时：
  → CLI 交互询问授权级别
  → 存储到 ~/.agentshow/config.json
  → 用户随时可改：agentshow config set privacy.level 1

首次连接云端时：
  → agentshow login → 浏览器 GitHub OAuth → JWT
```

不需要原生 App 做授权。CLI 交互 + 浏览器 OAuth 足够。

### 后续：SwiftUI 菜单栏 App（可选）

当产品验证后，可以做一个菜单栏 app 提升体验：
- 菜单栏图标显示活跃 session 数量
- 点击展开快速面板（peers 状态、最近 notes）
- 设置页面（隐私级别、同步频率）
- 一键暂停/恢复同步

技术选型：SwiftUI + AppKit，分发方式 DMG + Homebrew cask。
但这是验证 PMF 之后的事，MVP 阶段不需要。

---

## 技术栈总结

| 组件 | 技术 | 说明 |
|------|------|------|
| Daemon | Node.js + TypeScript | 复用现有技术栈，launchd 管理 |
| 文件监控 | chokidar | 跨平台，对 macOS FSEvents 有良好封装 |
| 本地存储 | SQLite (better-sqlite3) | 复用 v1 代码 |
| Skill | Claude Code Skill（Markdown） | 零依赖，放文件夹即用 |
| 云端 API | Cloudflare Workers | 复用原 Pagefly 设计 |
| 云端数据库 | Cloudflare D1 | 元数据和 notes |
| 云端存储 | Cloudflare R2 | 完整对话记录（Level 3） |
| 认证 | GitHub OAuth + JWT | CLI 和 Web 共用 |
| 前端 Dashboard | Workers SSR 或 React SPA | 后续决定 |

---

## Monorepo 新结构

```
agentshow/
├── packages/
│   ├── shared/          # 共享类型（已有，可复用）
│   ├── mcp/             # v1 MCP Server（保留，开源可用）
│   ├── daemon/          # 新：本地守护进程
│   ├── skill/           # 新：Claude Code Skill
│   ├── worker/          # 新：Cloudflare Worker 后端
│   └── web/             # 新：Dashboard 前端
├── docs/
├── examples/
└── ...
```

v1 的 MCP Server 继续保留——它是独立可用的开源工具，不依赖云端。Daemon 是 v2 的新方向，两者共存。

---

## Go/No-Go 节点

| 里程碑 | 验证指标 | 时间预估 |
|--------|---------|---------|
| Daemon MVP 可用 | 能自动检测所有 session，本地 SQLite 有数据 | Step 1 |
| Skill 可用 | /peers 和 /notes 能在 Claude Code 里工作 | Step 2 |
| 云端 MVP | 数据能同步上去，Dashboard 能看 | Step 3 |
| **PMF 验证点** | **>100 周活用户 + >5% 愿意付费** | Step 3 后 90 天 |
| 团队功能 | 有 3 个以上团队在用 | Step 4 |

---

## 与 v1 MCP 方案的关系

| | v1 MCP Server | v2 Daemon + Skill |
|---|---|---|
| **状态** | 已完成，开源 | 新方向 |
| **定位** | 独立开源工具 | 商业产品核心 |
| **是否保留** | 是，继续维护 | — |
| **用户价值** | 轻量多 session 协调 | 全面 Agent 可观测性 |
| **变现路径** | 无（免费开源） | 有（云端 SaaS） |

v1 MCP 作为开源 hook 获取早期用户和社区信任，v2 Daemon + Cloud 是商业化路径。两者互补。
