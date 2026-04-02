# Pagefly 对标分析报告

> 分析日期：2026-04-02
> 分析工具：dbs-benchmark skill（五重过滤法）

---

## 五重过滤总览

14 个候选对标，最终通过 3 个：

| 候选 | 赚钱 | 看懂 | 能仿 | 排除自我 | 不讨论本质 | 最终 |
|------|------|------|------|----------|-----------|------|
| ChatGPT 分享链接 | ❌ | - | - | - | - | 淘汰 |
| Claude Artifacts | ❌ | - | - | - | - | 淘汰 |
| Asciinema | ❌ | - | - | - | - | 淘汰 |
| Carbon.sh | ❌ | - | - | - | - | 淘汰 |
| GitHub Gist | ❌ | - | - | - | - | 淘汰 |
| **Loom** | ✅ | ✅ | ⚠️ | ✅ | ✅ | **有条件通过** |
| **Scribe** | ✅ | ✅ | ✅ | ✅ | ✅ | **通过** |
| **Tango** | ✅ | ✅ | ✅ | ✅ | ✅ | **通过（次优先）** |
| Supademo | ✅ | ✅ | ⚠️ | ✅ | ✅ | 有条件通过 |
| Notion | ✅ | ✅ | ❌ | - | - | 淘汰 |
| Obsidian Publish | ⚠️ | ✅ | ⚠️ | ✅ | ✅ | 淘汰 |
| Replit | ✅ | ✅ | ❌ | - | - | 淘汰 |
| Read.ai | ⚠️ | ✅ | ⚠️ | ✅ | ✅ | 淘汰 |
| tl;dv | ⚠️ | ✅ | ❌ | - | - | 淘汰 |

---

## 第一对标（必须模仿）：Scribe

**$13 亿估值，78,000 家付费客户，收入同比翻倍**

### 为什么是 Scribe

1. **动作结构完全一致**——Scribe："装扩展→操作→自动生成 guide→分享链接"；Pagefly："装 CLI→push session→自动渲染→分享链接"
2. **确定赚钱**——$13 亿估值，78,000 家付费客户
3. **增长飞轮一样**——每个分享链接=免费获客
4. **定价可参考**——Scribe Pro $25/user/month，Pagefly Pro $5/month 有 5 倍价格优势

### Scribe 商业模式

- **获客**：Chrome 扩展免费装，生成文档自带品牌水印传播
- **转化**：个人 $25/month，团队 $13/seat/month（5 seat 起），企业定制
- **交付**：浏览器扩展 + 桌面端 + 云端文档
- **复购**：成为企业内部 SOP 管理工具后替换成本极高

### 模仿路径

1. 把 `pagefly push` 做到 30 秒内从 session 到链接
2. 每个链接底部固定显示"Made with Pagefly"+ 注册引导
3. 研究 Scribe 首次使用引导流程，在 `pagefly login` 后做同样 onboarding
4. 后期加 Team 功能，按 seat 收费

> **Scribe 证明了"把工作过程自动变成可分享文档"价值 $13 亿。Pagefly 做同一件事，只是场景从"人的操作过程"变成"Agent 的推理过程"。**

---

## 第二对标（增长策略参考）：Loom

**2026 年预估收入 $1.5 亿，被 Atlassian 收购**

### 值得模仿的

1. **"每次分享=获客"的飞轮**——每个视频链接都带品牌
2. **Creator 收费模型**——按创建者收费，观看者免费
3. **企业级路径**——个人免费→团队收费→企业大单（平均年单 $8.5 万）

### Loom 商业模式

- **获客**：产品内传播（每个链接带品牌），免费版吸引个人
- **转化**：功能限制推动升级，团队需求推动购买
- **交付**：云端 SaaS
- **复购**：嵌入工作流后难替换

### 不能完全模仿的原因

技术栈完全不同（视频 vs 文本渲染），但增长策略可以照搬。

---

## 第三对标（定价/功能分层参考）：Tango

### 参考价值

- 免费版限制 15 个 shared workflows
- Enterprise 有 PII 自动模糊（类似 Pagefly P2 的"Agent 自动脱敏"）
- Pro $22/user/month 定价确认 Pagefly $5/month 有价格竞争力

---

## 立刻可执行的 3 件事

1. **去 Scribe 注册账号**，完整走一遍"录制→生成→分享→查看"流程，记录每步体验细节，然后把 `pagefly push` 做到一样顺滑

2. **看 scribehow.com 的公开 Guide 页面**，研究品牌露出、链接结构、SEO 元数据，逐项复制到 Pagefly

3. **定价从两层改为三层**：Free / Pro $5-8/month / Team $X/seat/month，从第一天预留团队收费空间

---

## 数据来源

- Loom Revenue & Financials - GetLatka
- Scribe $1.3B valuation - TechCrunch (2025-11)
- Scribe/Tango/Supademo Pricing Pages
- Notion Revenue - Sacra
- Replit $3B valuation - TechCrunch (2025-09)
- ChatGPT Shared Links FAQ - OpenAI
- Claude Artifacts Sharing - Help Center
