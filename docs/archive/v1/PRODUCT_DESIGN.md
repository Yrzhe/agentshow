# Pagefly — Product Design Document

> Agent Session 的 Loom。一键把你和 AI Agent 的工作过程变成可分享、可浏览、可被其他 Agent 消费的链接。

**Tagline**: Share how your Agent thinks, not just what it outputs.

**Domain**: pagefly.ink (腾讯云注册，Cloudflare DNS 托管)

**Date**: 2026-04-01

---

## 1. 产品定位

### 要解决的问题

AI Agent 的工作过程（推理链路、来源、中间决策）在当前工具里是一次性的、不可分享的。用户只能把结论复制出来，对方无法溯源、无法接手、无法学习。

### 核心场景

1. **协作溯源** — 让合作者看到完整推理过程，能追问、能接手
2. **教学展示** — 公开与 Agent 的交互过程，教别人"怎么用 Agent 做事"
3. **去重复劳动** — 让别人知道你已经探索过什么、排除了什么
4. **机器消费** — 让别的 Agent 通过 API 直接读取你的 Agent 工作成果

### 核心用户画像

- 重度 AI Agent 用户（Claude Code / Cursor / Copilot 等）
- 需要频繁与人协作、交接 Agent 工作成果
- 有内容输出欲望——想教别人怎么用 Agent，或展示自己的工作流

### 类比

**"Agent Session 的 Loom"** — Loom 把录屏分享从"导出视频 → 上传 → 发链接"简化成"点一下就分享"。Pagefly 对 Agent 工作流做同样的事。

### 竞品对比

| | Pagefly | Obsidian Publish | GitHub Gist | ChatGPT 分享链接 |
|---|---|---|---|---|
| Agent 过程可视化 | 核心功能 | 不支持 | 不支持 | 只能看对话原文 |
| 结构化浏览 | 对话式渲染+导航 | 文档式 | 无 | 无 |
| 机器可读 API | 有 | 无 | 有但无结构 | 无 |
| 密码保护/分层 | 有 | 无 | 有 | 有但简陋 |
| 自定义样式 | 主题博物馆 | 有限 | 无 | 无 |

---

## 2. 信息架构

### 数据模型

```
User (username.pagefly.ink)
 └── Project A (/project-a/)
 │    ├── Session 1 (用户选择上传)
 │    └── Session 2
 └── Project B (/project-b/)
      ├── Session 1
      └── Session 3
```

- 每个用户一个二级域名：`username.pagefly.ink`
- 用户主页展示所有公开 Project 列表
- 每个 Project 下包含用户**选择性上传**的 Session（不是全量同步）
- Session 可以持续更新（sync）

### URL 结构

```
username.pagefly.ink                           → 用户主页（Project 列表）
username.pagefly.ink/project-name/             → 项目页（Session 列表）
username.pagefly.ink/project-name/session-1    → 具体 Session（对话展示）
```

### 权限模型

**写入方（站长）**：必须登录
- GitHub OAuth → 获取 JWT token
- CLI push / 管理 / 删除都需要 token

**读取方（访客/Agent）**：不需要登录
- 公开项目 → 直接访问
- 加密项目 → 输入密码 或 带 `?pwd=xxx` 参数
- API 同理 → `GET /api/sessions/{id}` 公开直接返回，加密的带 `?pwd=xxx`

没有"访客注册"概念。

### 密码保护

- 密码加在 **Project 级别**
- 访问方式一：访问时弹出密码输入页
- 访问方式二：站长生成带密码的一键链接 `xxx.pagefly.ink/project?pwd=abc123`
- 两种方式共存，站长可选

---

## 3. Session 内容格式

### 上传格式（两种都支持）

**格式 A: 原始对话 JSON（无摩擦上传）**

CLI 直接从 Claude Code 导出对话的原始数据，Pagefly 负责解析渲染。

第一期只支持 Claude Code 格式，但内部存储统一转为 Pagefly schema，后续加其他工具只需写转换层。

**格式 B: Markdown 手动整理（灵活控制）**

用户或 Agent 整理后的 Markdown，用约定标记区分角色：

```markdown
---
title: "XX 领域调研"
project: ai-research
---

> [user]
> 帮我调研一下 XX 领域的现状

> [agent]
> 我先从三个维度来分析...

> [user]
> 这个方向再深入一下

> [agent]
> 进一步分析发现...
```

### 展示形态（对话式渲染）

```
┌──────────────────────────────────────────┐
│  yrzhe / ai-research / session-1         │
├────────────┬─────────────────────────────┤
│            │                             │
│  侧边栏     │  👤 你                      │
│            │  帮我调研一下 XX 领域的现状     │
│  📁 项目名  │                             │
│   ├ Ses.1  │  🤖 Agent                    │
│   ├ Ses.2  │  我先从三个维度来分析...        │
│   └ Ses.3  │  > 来源: [1] https://...     │
│            │                             │
│            │  👤 你                      │
│            │  这个方向再深入一下            │
│            │                             │
│            │  🤖 Agent                    │
│            │  进一步分析发现...             │
│            │  ```python                  │
│            │  code here                  │
│            │  ```                        │
│            │                             │
│            │  👤 你                      │
│            │  总结一下结论                 │
│            │                             │
│            │  🤖 Agent                    │
│            │  ## 结论                     │
│            │  1. ...                     │
│            │  2. ...                     │
│            │                             │
│            │  ---                        │
│            │  来源列表                    │
│            │  [1] https://...            │
│            │  [2] https://...            │
└────────────┴─────────────────────────────┘
```

### 关键交互

- **侧边栏** — 同项目下的所有 Session，点击切换
- **目录导航** — 右侧浮动 TOC（根据 Agent 回答中的标题自动生成）
- **来源引用** — 点击跳转原始链接，hover 预览
- **代码块** — 语法高亮 + 一键复制
- **暗色/亮色** — 跟随系统或手动切换
- **移动端适配** — 侧边栏收起为汉堡菜单

### 用户主页

```
┌──────────────────────────────────────────┐
│  yrzhe's Pagefly                         │
│  Bio / GitHub 链接 / 头像                 │
├──────────────────────────────────────────┤
│                                          │
│  📁 AI Research          公开  3 sessions │
│  📁 Agent Tutorials      公开  5 sessions │
│  🔒 Team Collab          加密             │
│                                          │
└──────────────────────────────────────────┘
```

---

## 4. 技术架构

### 基础设施

全部基于 Cloudflare 全家桶，域名腾讯云注册，NS 指向 Cloudflare。

```
┌─────────────────────────────────────────────────┐
│                    用户侧                        │
│                                                  │
│  CLI 工具 (Node.js/TS)       浏览器访问           │
│  pagefly push/login/list     username.pagefly.ink│
└──────────┬──────────────────────┬────────────────┘
           │                      │
           ▼                      ▼
┌─────────────────────────────────────────────────┐
│            Cloudflare Worker (路由层)             │
│                                                  │
│  /api/auth/*      → GitHub OAuth + JWT 签发      │
│  /api/upload      → 接收文件 → R2 + D1 索引      │
│  /api/projects    → 项目 CRUD                    │
│  /api/sessions    → Session CRUD (人+机器共用)    │
│                                                  │
│  /{user}/{project}/{session}                     │
│       → D1 查权限（密码？公开？）                  │
│       → R2 取原始内容                             │
│       → Worker 解析+转 HTML + 注入主题模板        │
│       → KV 缓存热门页面                           │
└──────────┬──────────┬───────────┬────────────────┘
           │          │           │
           ▼          ▼           ▼
        ┌─────┐   ┌─────┐    ┌─────┐
        │ R2  │   │ D1  │    │ KV  │
        │存储  │   │元数据│    │缓存  │
        └─────┘   └─────┘    └─────┘
```

**R2**: 原始文件存储（Markdown 和 JSON）
**D1**: 用户表、项目表、Session 表、密码、主题配置
**KV**: 渲染后的 HTML 缓存（按 URL key）

### D1 核心表结构

```sql
-- 用户表
CREATE TABLE users (
    id TEXT PRIMARY KEY,
    github_id INTEGER UNIQUE NOT NULL,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT,
    avatar_url TEXT,
    bio TEXT,
    token_hash TEXT NOT NULL,
    theme TEXT DEFAULT 'default',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 项目表
CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    slug TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    password_hash TEXT,          -- NULL = 公开
    is_public BOOLEAN DEFAULT true,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, slug)
);

-- Session 表
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    slug TEXT NOT NULL,
    title TEXT NOT NULL,
    r2_key TEXT NOT NULL,        -- R2 中的文件路径
    format TEXT NOT NULL,        -- 'markdown' | 'claude-code-json'
    order_index INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, slug)
);
```

### 关键技术决策

| 决策 | 选择 | 原因 |
|------|------|------|
| 渲染方式 | Worker 实时转换 | 不需要构建步骤，上传即生效，KV 缓存解决性能 |
| Markdown 解析 | markdown-it | 轻量、插件生态好、Worker 环境兼容 |
| JSON 对话解析 | 自研解析器 | Claude Code 格式专用，转为统一内部 schema |
| 主题系统 | CSS 变量 + HTML 模板 | 切换主题只换 CSS，不用重新渲染 |
| CLI 语言 | Node.js (TypeScript) | 跟 Worker 共享类型定义和 schema |
| 认证 | GitHub OAuth → JWT | CLI 和 Web 共用一套 token |
| 通配符域名 | *.pagefly.ink → Worker | Cloudflare DNS 原生支持 |

### 机器可读 API

```
GET  username.pagefly.ink/api/projects
GET  username.pagefly.ink/api/projects/{slug}
GET  username.pagefly.ink/api/projects/{slug}/sessions
GET  username.pagefly.ink/api/projects/{slug}/sessions/{id}
GET  username.pagefly.ink/api/projects/{slug}/sessions/{id}?pwd=xxx

响应格式:
{
  "title": "XX 调研",
  "format": "conversation",
  "messages": [
    { "role": "user", "content": "..." },
    { "role": "agent", "content": "...", "sources": ["https://..."] }
  ],
  "metadata": {
    "agent": "claude-code",
    "created_at": "2026-04-01T10:00:00Z",
    "updated_at": "2026-04-01T12:00:00Z"
  }
}
```

---

## 5. CLI 工具设计

### 命令列表

```bash
# 认证
pagefly login                    # 浏览器跳转 GitHub OAuth → 本地存 token
pagefly logout
pagefly whoami                   # 显示当前登录用户

# 发布
pagefly push ./session.md --project ai-research          # 上传 Markdown
pagefly push ./session.json --project ai-research        # 上传 Claude Code JSON
pagefly push ./session.md --project ai-research --title "XX调研"

# 管理
pagefly list                     # 列出所有项目和 Session
pagefly list ai-research         # 列出某项目下的 Session

# 更新
pagefly sync ./session.md --project ai-research --session session-1   # 增量更新

# 删除
pagefly rm ai-research/session-1
pagefly rm ai-research            # 删除整个项目

# 项目管理
pagefly project create ai-research --title "AI Research"
pagefly project set-password ai-research                  # 交互式设置密码
pagefly project make-public ai-research
pagefly project make-private ai-research
```

### 认证流程

```
pagefly login
  → 打开浏览器 → GitHub OAuth 授权页
  → 用户授权 → 回调到 Pagefly Worker
  → Worker 创建/更新用户记录，签发 JWT
  → CLI 通过 localhost 回调接收 token
  → token 存储在 ~/.pagefly/config.json
```

### config.json

```json
{
  "token": "eyJhbG...",
  "username": "yrzhe",
  "api_base": "https://api.pagefly.ink"
}
```

---

## 6. 主题系统

### MVP（3 个默认主题）

1. **Default** — 干净的白底黑字，对话气泡式
2. **Terminal** — 深色背景，等宽字体，代码感
3. **Paper** — 类似纸质文档的暖色调，衬线字体

### 主题实现

每个主题 = 一个 CSS 文件 + CSS 变量覆盖：

```css
/* themes/terminal.css */
:root {
  --bg-primary: #1a1a2e;
  --bg-secondary: #16213e;
  --text-primary: #e0e0e0;
  --text-secondary: #a0a0a0;
  --accent: #00d4ff;
  --user-bubble: #2a2a4a;
  --agent-bubble: #1a3a4a;
  --font-body: 'JetBrains Mono', monospace;
  --font-heading: 'JetBrains Mono', monospace;
  --border-radius: 4px;
}
```

### 样式博物馆（P1）

- 用同一份示例 Session 内容，展示所有主题的实际效果
- 左右对比 / 轮播预览
- 一键应用到自己的站点
- 后期支持社区投稿主题

---

## 7. 功能优先级

### P0 — MVP（第一个可用版本）

| 功能 | 说明 |
|------|------|
| CLI: login / push / list / sync | 核心上传工具 |
| GitHub OAuth | 用户认证 |
| Session 对话式渲染 | 核心展示体验 |
| Claude Code JSON 解析 | 第一个支持的 Agent 格式 |
| Markdown 手动上传 | 灵活格式支持 |
| 密码保护 + 带密码链接 | 私密协作场景 |
| 3 个默认主题 | 基本样式选择 |
| 机器可读 API | 让其他 Agent 消费 |
| 暗色/亮色切换 | 基础体验 |
| 移动端适配 | 基础体验 |
| 用户主页 | Project 列表页 |

### P1 — 第二阶段

| 功能 | 说明 |
|------|------|
| 样式博物馆 | 10+ 主题 + 实时预览画廊 |
| 在线编辑器 | 上传后可微调、脱敏、重组 |
| 分层可见 | 同一内容，不同权限看到不同深度 |
| 站内搜索 | 全文搜索 |

### P2 — 后期

| 功能 | 说明 |
|------|------|
| Agent 自动脱敏 | 上传时自动识别遮盖敏感信息 |
| MCP Server | Agent 通过 MCP 协议读写 Pagefly |
| 社区主题 | 用户提交自己的主题 |
| GitHub 同步 | 连接 repo 自动发布 |
| 协作评论 | 在 Session 某个步骤下留言 |
| 更多 Agent 格式 | ChatGPT、Cursor 等 |
| 自定义 CSS | 付费用户深度定制 |

### 明确不做的事

- 邮箱注册（只用 GitHub OAuth）
- 实时协作编辑（不是 Google Docs）
- 自托管版本（只提供云服务）
- Agent 执行能力（只展示，不运行）

---

## 8. 定价

### Free

- 1 个用户主页 (`username.pagefly.ink`)
- 3 个 Project
- 每个 Project 10 个 Session
- 单文件 2MB 上限
- 总存储 50MB
- 公开 + 密码保护
- API 读取
- 3 个默认主题

### Pro ($5/月 或 ¥30/月)

- 无限 Project 和 Session
- 单文件 20MB
- 总存储 2GB
- 全部主题解锁
- 分层可见
- 自定义 CSS
- 优先支持

---

## 9. 成本估算

全部基于 Cloudflare 免费额度：

| 资源 | 免费额度 | 预估消耗（1000 活跃用户） |
|------|---------|------------------------|
| Workers 请求 | 10万次/天 | ~10万次/天（刚好） |
| R2 存储 | 10GB | Session 以文本为主，够用 |
| R2 读取 | 1000万次/月 | 充裕 |
| D1 存储 | 5GB | 元数据很小，几十万条没问题 |
| D1 读取 | 500万行/天 | 充裕 |
| KV 读取 | 10万次/天 | 缓存热门页面 |

**早期零成本运营。** 超出免费额度后 Workers Paid $5/月起（含 1000 万次请求）。

---

## 10. 技术栈总结

| 层 | 技术 | 说明 |
|---|---|---|
| DNS | Cloudflare DNS | 腾讯云注册域名，NS 指向 CF |
| 计算 | Cloudflare Workers | API + SSR 渲染 |
| 存储 | Cloudflare R2 | Markdown/JSON 原文件 |
| 数据库 | Cloudflare D1 | 用户/项目/Session 元数据 |
| 缓存 | Cloudflare KV | 渲染后的 HTML 页面缓存 |
| CLI | Node.js + TypeScript | 跟 Worker 共享类型 |
| 认证 | GitHub OAuth + JWT | CLI 和 Web 共用 |
| Markdown | markdown-it | Worker 环境兼容 |
| 主题 | CSS 变量 | 零 JS 切换 |
