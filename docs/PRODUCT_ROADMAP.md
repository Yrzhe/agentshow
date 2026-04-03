# AgentShow — 产品路线图

> 更新: 2026-04-03
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

---

## 待做

### Step 4: Session 摘要 & 搜索 ⭐ 最高优先级

**为什么**: 监控 ≠ 价值。用户不需要看 agent 在干什么（已经知道），需要干完之后的总结和找回。

#### 4a: 自动 Session 摘要
- [ ] Session 结束时自动生成摘要（用 AI 总结对话内容）
- [ ] 摘要存到 cloud_sessions 的 summary 字段
- [ ] Dashboard 上 session 列表显示摘要预览
- [ ] 可在 Daemon 本地生成（调 Claude API）或 Worker 端生成

#### 4b: 全文搜索
- [ ] 跨 session 搜索："我在哪个 session 里讨论过 X？"
- [ ] 搜索 content_preview + tool_name + 摘要
- [ ] Worker API: GET /api/search?q=keyword
- [ ] Dashboard 搜索框 + 结果页面

#### 4c: 每日工作总结
- [ ] 定时任务（或手动触发）：生成"今日 Agent 工作总结"
- [ ] 按项目分组，列出每个 session 的关键产出
- [ ] 可以导出为 Markdown 或发送到邮箱

### Step 5: 成本管理

#### 5a: Token 成本换算
- [ ] 配置模型单价（input/output per 1M tokens）
- [ ] Dashboard 显示美元金额而不是只显示 token 数
- [ ] 日/周/月 成本趋势图

#### 5b: 预算告警
- [ ] 设置每日/每月预算上限
- [ ] 超出时通过邮件或 Dashboard 通知
- [ ] 按项目设置独立预算

#### 5c: 成本归因
- [ ] 按项目、按 session、按工具类型拆分成本
- [ ] "哪个项目花的最多？""Bash 工具比 Read 贵多少？"

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

### 当前轮次：Step 4 (Session 摘要 & 搜索)

| 任务 | 工程师 | 依赖 | 预估 |
|------|--------|------|------|
| 4b: 全文搜索 API + Dashboard | 工程师 A | 无 | ~400 LOC |
| 4a: 自动 Session 摘要 | 工程师 B | 无 | ~300 LOC |
| 4c: 每日工作总结 | 后续 | 4a | ~200 LOC |
| 5a: Token 成本换算 | 后续 | 无 | ~200 LOC |

**4a 和 4b 可并行。**

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
