# AgentShow 方向评估报告

> 日期：2026-04-02
> 分析来源：4 路并行分析（Startup Advisor + 商业诊断 + 产品评估 + 市场调研）

---

## 核心问题：这是伪需求吗？

### 四方一致结论

**需求方向真实，但"通用 Agent 通信基础设施"这个产品形态风险极高。**

| 分析角度 | 判断 |
|---------|------|
| **Startup Advisor** | 底层痛点真实，产品形态可能是"伪产品"。时机偏早 12-18 个月 |
| **商业诊断** | 造了一台机器但没有投币口。免费开源的阶段 1 没有变现路径 |
| **产品评估** | 三阶段路线其实是三次创业。阶段间用户动机断裂 |
| **市场调研** | 值得做，但不要做成另一个"泛 agent 平台"。空位存在 |

### 真需求的信号

1. **多 Agent 冲突真实发生** — 多个 session 改同一文件、重复探索相同方向
2. **知识孤岛真实存在** — 一个 session 学到的经验，另一个不知道
3. **AI 治理是确定趋势** — Agent 权限越大，可观测性和控制越刚需
4. **没有人占位** — "从本地多 session 感知长成云端多 agent 协作层"这条路没有头部产品
5. **Anthropic multi-agent 性能数据** — 内部 eval 显示 multi-agent 比单 agent 高 90.2%

### 伪需求的信号

1. **大部分用户还在学怎么用好一个 Agent** — 多 Agent 工作流是少数 power user 的场景
2. **替代方案"够用"** — 人工协调（80%+ 够用）、Git 本身解决冲突（90%）、共享文件
3. **没有用户在主动寻找解决方案** — Twitter/Reddit 上相关讨论远不如"Agent 更可靠"多
4. **平台方必然进入** — Google A2A 已发布、Anthropic remote MCP + OAuth、OpenAI Agents SDK

---

## 竞品格局（调研人员整理）

### Multi-Agent 框架层

| 竞品 | 融资 | GitHub Stars | 定位 | 与 AgentShow 关系 |
|------|------|-------------|------|------------------|
| **CrewAI** | $1800 万 | 25K+ | Multi-agent 编排框架 + AMP Cloud | 做编排，不做实时状态共享 |
| **LangGraph** | LangChain 生态 | 8K+ | Agent 工作流 DAG | 偏向编排，不做 session 感知 |
| **AutoGen** | 微软背景 | 40K+ | 多 Agent 对话框架 | 学术味重，不贴近真实开发流 |
| **MetaGPT** | DeepWisdom | 50K+ | Multi-agent 软件开发 | 全自动化，不是人+Agent 协作 |

### 关键发现

> "市场不缺 'multi-agent' 概念，缺的是可验证的协作效率收益。"
> — Hacker News 社区对 CrewAI 融资的典型反馈

这些框架都在做**编排层**（怎么组织 Agent 工作），没人做**协调与可见性层**（Agent 在做什么、做了什么决定、花了多少钱）。

### 大厂动向

| 公司 | 动作 | 对 AgentShow 的影响 |
|------|------|-------------------|
| **Anthropic** | subagents + remote MCP + OAuth；multi-agent research 比单 agent 高 90.2% | 推云端 agent 生态，但不会做跨厂商协调 |
| **OpenAI** | Agents SDK（handoffs, tracing, orchestrating） | 做自家编排，不做跨工具可见性 |
| **Google** | A2A 协议，50+ 合作伙伴 | 做通信标准，不做应用层 |

---

## 四方共识：应该做什么

### 不要做的

**通用 Agent 通信基础设施**（= 平台方的战场）
- Anthropic 会在 MCP 里加 Agent 发现和通信
- Google A2A 已经在做通信标准
- 创业公司在协议层没有持久优势

### 应该做的

**Agent 工作的协调与可见性层**（= 大厂不会做的）

类比：AWS 做了计算基础设施，但 Datadog 做了可观测性层。Anthropic 做 Agent 运行时，AgentShow 做 Agent 可观测性。

### 调研人员建议的定位

> **AgentShow = 多 agent / 多 coding session 的协作总线**

四个核心能力：
1. **Presence** — 每个 agent 在做什么、状态如何
2. **Shared Notes** — 共享笔记、handoff memo、决策记录
3. **Coordination** — 依赖关系、去重、任务接力
4. **Replay/Audit** — 过程回放、责任可追踪

---

## 重新定义的路线图

### 原路线（有问题）

```
阶段 1: 本地 MCP 协调 → 阶段 2: Session 分享浏览 → 阶段 3: 跨用户协作
```

**问题**：三个阶段解决三个不同的问题，用户动机不连续。阶段 2 的"分享"需要教育市场。

### 新路线（四方共识）

```
Step 1 — Hook（已完成，免费开源）
  本地 MCP Server：多 session 状态感知 + 笔记共享
  目标：获取早期开发者用户
  验证指标：>500 GitHub stars, >100 周活安装

Step 2 — Wedge（下一步，付费起点）
  云端同步 + Agent 可观测性：
  - 跨设备持久化（换电脑不丢 session 历史）
  - Agent 行为日志和决策回放
  - Token 消耗追踪和优化建议
  - 成本归因（哪个 Agent session 花了多少钱）
  定价：Free tier + $10-20/月
  验证指标：>5% 付费转化

Step 3 — Expand（规模化）
  团队 Agent 管理面板：
  - 谁的 Agent 在做什么
  - Agent 决策审计和合规
  - 权限控制
  定价：$30-50/seat/月
  验证指标：团队 ARR、扩展率
```

### 为什么这条路径更好

1. **每一步都有独立价值** — 不依赖下一步才有意义
2. **用户动机连续** — 协调 → 持久化 → 可见性 → 治理
3. **避开大厂** — Anthropic 做运行时，不做跨 Agent 协调和治理
4. **天然企业路径** — 开发者自下而上 → 团队管理层自上而下

---

## 本地 MCP vs Skills vs 云端 API

### 结论：MCP 是正确选择

| 方案 | 优点 | 缺点 |
|------|------|------|
| **MCP Server**（当前） | 标准协议，跨工具通用；独立进程有状态；本地→远程无缝过渡 | 配置稍复杂 |
| **Skills** | 安装简单，放文件夹就行 | 只限 Claude Code；无持久进程 |
| **云端 API** | 天然跨设备跨用户 | 需要网络和认证；延迟高 |

**推荐策略**：
- MCP 作为核心（标准协议，面向未来）
- 可选提供 Skill 作为轻量入口（降低试用门槛）
- 云端是 Step 2 的事，到时只需把 MCP 后端从 SQLite 换成云端 API

MCP 的另一个战略价值：**不只 Claude Code 能用**。Cursor、Windsurf、Copilot 都在接入 MCP 协议，做 MCP 意味着你的产品天然跨工具。

---

## Go/No-Go 决策框架

| 时间点 | 指标 | Go | No-Go |
|--------|------|-----|-------|
| 上线 30 天 | GitHub stars + 周活 | >500 stars, >100 周活 | <100 stars, <20 周活 |
| 上线 90 天 | 留存 + 社区反馈 | 30 天留存 >30%，用户主动要求云端功能 | 留存 <10%，无云端需求 |
| Step 2 Beta 30 天 | 付费转化 | >5% 活跃用户付费 | <1% 付费 |
| Step 2 上线 90 天 | MRR | >$1K 且月增 >20% | <$200 且停滞 |

### 必须监控的外部信号

1. **Anthropic 是否在 MCP 中加 session 发现** — 如果加了，加速往可观测性层走
2. **多 Agent 工作流是否在普及** — 监控 Claude Code 更新、Twitter 讨论量
3. **A2A 协议是否形成标准** — 如果形成，MCP + A2A 双协议支持是差异化

---

## 一句话总结

**AgentShow 看到了正确的未来（Agent 间需要协调），但应该往上走一层：不做通信管道（大厂的活），做协调与可见性层（大厂不做的活）。从"Agent 的即时通讯"变成"Agent 的 Datadog"。**
