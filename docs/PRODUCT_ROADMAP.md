# AgentShow — 产品路线图

> 更新: 2026-04-04
> 定位: Agent 工作的可见性层 — 从监控到洞察到行动

---

## 已完成

### Step 1: Daemon MVP ✅
- [x] Session 发现（~/.claude/sessions/*.json）
- [x] JSONL 增量解析（byte-offset 追踪）
- [x] Token/工具/内容提取（过滤 tool_result 噪音）
- [x] PID 生命周期管理（discovered → active → ended）
- [x] SQLite 本地存储（WAL 模式）
- [x] HTTP API localhost:45677
- [x] launchd 自启动
- [x] 94 个测试通过

### Step 2: Skill ✅
- [x] /peers, /stats, /projects, /history 命令
- [x] 通过 curl daemon API 实现

### Step 3: Cloud Dashboard ✅
- [x] Cloudflare Worker + D1 数据库
- [x] Daemon → Cloud 增量同步（隐私分级 0-3）
- [x] GitHub OAuth + 邮件验证码登录（Resend）
- [x] 邮箱白名单（ALLOWED_EMAILS）
- [x] 邮箱统一身份（同邮箱 = 同账号）
- [x] API Token 管理
- [x] Dashboard SPA：sessions 列表、对话气泡详情、projects、usage、settings
- [x] 事件合并显示（相邻同角色合并）
- [x] 工具调用 badge 展示
- [x] 自部署文档

### Step 3.5: MCP-Daemon Bridge ✅
- [x] Daemon 读取 MCP notes 表，通过 cloud sync 上传笔记
- [x] Session 通过 cwd 关联 MCP session，附带 task/files
- [x] cloud_notes D1 表 + upsert 语义（migration 0004）
- [x] Notes API: GET /api/notes?project_slug=&session_id=
- [x] Usage daily API: GET /api/usage/daily?days=N
- [x] 隐私过滤：shapeNoteForSync() (level >= 2)
- [x] hasMcpTable() 优雅降级
- [x] 8 个 bridge 测试通过

### Step 4: Session 摘要 & 搜索 ✅

**为什么**: 监控 ≠ 价值。用户不需要看 agent 在干什么（已经知道），需要干完之后的总结和找回。

#### 4a: Session 摘要 ✅
- [x] Workers AI (Llama 3.1 8B) 生成 session 摘要
- [x] 摘要存到 cloud_sessions 的 summary 字段
- [x] Dashboard session 列表显示摘要预览（截断 80 字符）
- [x] Dashboard session 详情页 Generate Summary 按钮

#### 4b: 全文搜索 ✅
- [x] 跨 session 搜索 events + notes（UNION ALL with source_type）
- [x] Worker API: GET /api/search?q=keyword&limit=&offset=
- [x] Dashboard 搜索页：关键词高亮、分页、note badge

#### 4c: 每日工作总结 ✅
- [x] API: GET /api/daily-summary?date=YYYY-MM-DD（按项目分组，含 session 详情）
- [x] Dashboard 页面：日期选择器、项目卡片、session 列表、token 统计
- [x] Server + Worker 双端实现

### Dashboard 增强 ✅
- [x] Session 详情：Task 卡片、Files 列表、关联 Notes、AI 摘要
- [x] Sessions 列表：summary 列、project 过滤（?project=slug）
- [x] Usage 页：日 token 柱状图（近 14 天）
- [x] Search 页：搜索 + 高亮 + note 结果 badge

### Docker 迁移 Phase 1 ✅
- [x] packages/server: Node.js + better-sqlite3 + Hono (32 源文件)
- [x] 全部 API 路由移植 (sync, sessions, projects, search, notes, usage, tokens, auth, summary)
- [x] AI 摘要可配置 (Anthropic API / disabled)
- [x] auto-migration runner
- [x] Dockerfile (multi-stage Node 20 alpine) + docker-compose.yml
- [x] .env.example
- [x] Sync datetime bug 修复

---

## 待做

### Step 5: 成本管理 ✅

#### 5a: Token 成本换算 ✅
- [x] 配置模型单价（Claude Opus $15/$75, Sonnet $3/$15, Haiku $0.80/$4 per 1M tokens）
- [x] Dashboard 显示美元金额 + token 数
- [x] 日成本趋势图（GET /api/usage/cost, GET /api/usage/daily）
- [x] Server + Worker 双端实现

#### 5b: 预算告警 ✅
- [x] 设置每日/每月预算上限（budget_settings 表 + CRUD API）
- [x] Dashboard 预算使用进度条（绿/黄/红）
- [x] GET/PUT/DELETE /api/budget

#### 5c: 成本归因 ✅
- [x] 按项目、按 session、按工具类型拆分成本
- [x] Dashboard 成本归因页面（条形图 + 表格）
- [x] 点击项目展开 session 级成本明细

### Step 6: 团队功能

#### 6a: 团队空间
- [ ] 创建团队，邀请成员（通过邮箱）
- [ ] 团队 Dashboard：看所有成员的 session 活动
- [ ] 权限：admin（全看）、member（看自己 + 团队摘要）

#### 6b: 团队报告
- [ ] 团队周报：每个成员的 agent 产出汇总
- [ ] 成本分摊：谁花了多少

#### 6c: 审计日志
- [ ] 记录 agent 的关键决策（文件修改、命令执行、PR 创建）
- [ ] 可追溯："这个 bug 是哪个 session 引入的？"

### Step 7: 高级功能

#### 7a: Session 回放
- [ ] 时间线回放 agent 的完整对话过程
- [ ] 像 rrweb 一样的回放体验

#### 7b: 跨 session 工作流
- [ ] "Session A 完成后自动触发 Session B"
- [ ] 基于 Skill 或 daemon API 实现

#### 7c: Webhook 集成
- [ ] Session 结束 → 触发 webhook
- [ ] 可接 Slack、Discord、飞书通知
- [ ] 可触发 CI/CD

---

## 实现优先级 & 工程师分配

### 已完成轮次
- ~~Step 4a + 4b: Session 摘要 & 搜索~~ ✅ (2026-04-04)
- ~~Step 3.5: MCP-Daemon Bridge~~ ✅ (2026-04-04)
- ~~Docker 迁移 Phase 1~~ ✅ (2026-04-04)

### 已完成轮次：功能补齐 ✅ (2026-04-04)
- ~~Bridge 4A: Daemon API 暴露 MCP 数据~~ ✅
- ~~Bridge 4B: Skill 更新~~ ✅
- ~~4c: 每日工作总结~~ ✅
- ~~5a: Token 成本换算~~ ✅

### 已完成轮次：成本管理 ✅ (2026-04-04)
- ~~5b: 预算告警~~ ✅
- ~~5c: 成本归因~~ ✅

### 当前轮次：团队 + Webhook + 部署

| # | 任务 | 优先级 | 工程师 | 状态 |
|---|------|--------|--------|------|
| A | 7c: Webhook 集成 (session 结束通知) | 高 | Codex | ���发中 |
| B | Docker Phase 2: VPS 部���文档 | 中 | Codex | 开发中 |
| C | 6a: 团队空间 (CRUD, 邀请, 权限) | 高 | Codex #2 | 开发中 |
| D | 6b: 团队报告 (周报, 成本分摊) | 中 | Codex #2 | 开发中 |

**A+B 和 C+D 并行开发中。**

---

## 技术备注

### 搜索实现方案
- D1 支持 LIKE 查询，MVP 足够用
- 后续如果数据量大，可用 Cloudflare Vectorize 做语义搜索

### Session 摘要生成
- 方案 A: Daemon 本地调 Claude API 生成（需要用户配 ANTHROPIC_API_KEY）
- 方案 B: Worker 端用 Workers AI 生成（Cloudflare 免费额度）
- 方案 C: 用户手动触发（Dashboard 上点按钮）
- **建议先做方案 C（最简单），再做 B**

### 成本单价参考 (2026-04)
| Model | Input ($/1M) | Output ($/1M) |
|-------|-------------|---------------|
| Claude Opus 4.6 | $15 | $75 |
| Claude Sonnet 4.6 | $3 | $15 |
| Claude Haiku 4.5 | $0.80 | $4 |
