# Implementation Notes — agentshow

> **APPEND-ONLY.** Never edit or delete existing entries. To answer a
> prior open-question, append a new `resolution` entry instead.
>
> Entry header format (machine-parsed by notes.html — keep stable):
> `## [<ISO8601 UTC>] · <type> · <author>`
>
> Maintain via `scripts/notes.py` (see AGENTS.md). Do NOT hand-edit.
> Viewer: open `notes.html` (data is embedded — just double-click).

<!-- entries appended below; nothing above this line is ever rewritten -->

## [2026-08-29T06:49:46.173Z] · design-decision · claude-code
**members 一张表混装人和 agent**

`ProjectDO.members` 用一张表混装人和 agent：`{ memberId, kind: 'human' | 'agent' }`，
而不是 `humans[]` 和 `agents[]` 两张。

理由：agentshow 的全部赌注押在「agent 是同事不是工具」。分成两张表等于在数据层宣告
agent 是二等公民，后面每个界面都会被这个结构拖回「人在协作，agent 是工具」的形态 ——
Members 只列人、Activity 主语只能是人、文件 owner 只能是人。

对照组是 Paper 文件 `youware` 的 `project-collaboration` 页：那套设计里 Members 四个成员
全是人带邮箱，Activity 八条事件主语全是人，Files 的 OWNER 也全是人，agent 只出现在输入框
上的 "Data Analysis Expert" 下拉里。照搬那个结构就演示不到 agentshow 要演的东西。

---

## [2026-08-29T06:49:46.235Z] · design-decision · claude-code
**写 workspace 只做乐观并发，不做三方合并**

写 project workspace 只做乐观并发（比对 baseVersion），不做三方合并。

`writeFile({ path, content, baseVersion, authorId })`，baseVersion 不等于当前版本就拒绝，
并把**当前内容和当前版本**一起返回，agent 直接在新内容上重做。约五十行。

理由：agent 干活是长事务，几十秒到几分钟，它脑子里的快照会在这期间失效。共享盘会让这个失效
静默发生（写回一份基于旧内容的完整文件，抹掉别人的活且不报错）。乐观并发把静默覆盖变成一次
显式拒绝。重做对 agent 的成本接近零 —— 这个在人身上是次优解的方案，在 agent 身上是最优解。

升级路径：将来真需要并行改同一文件时，把「拒绝」分支换成三方合并，数据模型一行不动。

---

## [2026-08-29T06:49:46.293Z] · tradeoff · claude-code
**模型先走 Workers AI 而非外部 API**

模型先走 Workers AI，不走外部 API。

Workers AI 不需要 key，跟 Workers 同一计费口子，本地 `wrangler dev` 直接跑，
`cloudflare/agents-starter` 默认就是它。

代价：复审 agent 的评论质量可能撑不起「它真的看懂了」这个演示画面 —— 而整个 demo 的说服力
恰恰压在这上面。

之所以仍然先用它：`Think.getModel()` 是一个覆写点，换外部 API 是改一处的事。**不为此做抽象层**
——留一个明确的切换点比留一个 provider 接口更诚实，后者会在只有一个实现时腐烂。

---

## [2026-08-29T06:49:46.349Z] · open-question · claude-code
**跨主人 @提及要不要人批准**

单人阶段 `mention` 工具不需要人批准，agent 可以直接 @ 另一个 agent 并唤醒它。

理由：两个 agent 都是用户自己的，加确认只会让演示卡住。

但这个边界在多人阶段必须重新定：别人的 agent 进来之后，「我的 agent @ 别人的 agent」
要不要我点头 —— 不要，两个 agent 能自己聊起来，烧钱且失控；要，协作就慢下来。

**必须在动第三层（多人）之前有答案。** 现在不定是因为定了也没有验证它的场景。

缓解措施已经在设计里：每条 session 记提及深度，超过 3 跳停止并在 activity 里标出。
这挡的是环（A @ B、B @ A 的无限循环），不是挡越权。

---

## [2026-08-29T06:49:46.406Z] · open-question · claude-code
**agent 记忆跨 project 串味**

agent 的记忆和身份文档跨 project 共享，会串味。

agent 能改写自己的身份文档，而它同时在多个 project 干活 —— 在 project A 学到的东西
会改变它在 project B 的行为。

单人阶段这是**特性**：它真的在长，这是留存的护城河。
多人阶段这是**事故**：在你这学的东西被带到别人那去了。

两条可能的解法（都没验证）：给记忆分层（project 级 / agent 级分开存），
或者给 project 加隔离（agent 进不同 project 时挂不同的记忆视图）。

**同样必须在动第三层之前有答案。**

---

## [2026-08-29T07:48:57.205Z] · deviation · claude-code
**官方文档与包内源码有四处不符，已按源码修正设计**

写实现计划前把 `agents@0.21.0` / `@cloudflare/think@0.17.0` 装进 scratch 读了真实类型和
包内自带的 docs。官方 blog 和网站文档跟代码有四处对不上，都会导致按文档写的代码编译不过或
静默出错：

1. **Session API 在 `agents/experimental/memory/session`**，不在主包路径。
   `SessionManager.create(agent)` 是**静态建造者工厂**，`manager.create(name, meta)` 才是
   建 session 的实例方法 —— 两者同名，网站文档没区分。

2. **`create` / `get` / `list` / `getSession` / `rename` 全是同步方法**，只有 `delete` 是
   async。按文档 `await` 会拿到非 Promise。

3. **`SessionInfo` 没有 status 字段**（只有 `id/name/parent_session_id/model/source/
   input_tokens/output_tokens/estimated_cost/end_reason/created_at/updated_at`）。
   设计里的 in_progress/done 因此挪到 ProjectDO 的 session_index 表上。
   `source` 字段用来存 `project:<id>`。

4. **Think 集成的是 `@cloudflare/shell` 不是 `@cloudflare/computer`。**
   `Workspace` 的构造签名是 `new Workspace({ sql, r2, name })`，
   不是 Cloudflare changelog 里 computer 那个 `new Workspace({ storage })`。
   computer 还是 0.2.1 preview，从依赖里删掉了。

两个意外收获，都省掉了原计划里的工作量：

- **Think 自带 `this.workspace` 和八个已注册工具**（read/write/edit/list/find/grep/
  delete/bash）。agent 的私有盘一行代码都不用写。代价是**自定义工具名不能跟这八个撞** ——
  Think 的合并顺序是后者覆盖前者，撞名会静默顶掉内置工具且不报错。计划里为此加了一条
  自动化断言。
- **context block 的原生标签就叫 `soul` 和 `memory`**，正好对上设计里的「身份文档」和
  「记忆」，`configureSession` 还白送 `set_context` 工具让 agent 自己改写。

AI SDK 版本是 7.0.84，`tool({ description, inputSchema, execute })`，
`getTools(): ToolSet`。

---

## [2026-08-29T10:45:44.418Z] · deviation · claude-code
**Task 1：官方 getting-started 漏了一个 peer dep，另两条警告是噪音**

Task 1 实测，三处跟官方 getting-started 不符或它没说：

1. **`@ai-sdk/react` 是 `@cloudflare/think` 的 peer dependency，教程的 npm install 那行没列。**
   不装的话 `react.d.ts` 里 `import("@ai-sdk/react").UseChatHelpers` 解析失败，
   `useAgentChat` 的返回类型整个塌成 any，`messages.map((m) => ...)` 报 TS7006。
   装 `@ai-sdk/react@^4.0.0`（peer 范围是 `^3.0.0 || ^4.0.0`）后 tsc 零错误。

2. **npm 11 那条 allow-scripts 警告是噪音。** 它提示 `workerd` / `esbuild` 的 postinstall
   被拦，但二进制其实由平台包（`@cloudflare/workerd-darwin-arm64`、`@esbuild/darwin-arm64`）
   预编译随包发，不依赖 postinstall。实测 `npx wrangler --version` 正常输出 4.127.1。
   **不要去 approve-scripts。**

3. **`npm init -y` 默认给 `"type": "commonjs"`**，必须改成 `module`，
   否则 Think 和 agents 的 ESM import 在第一次加载就炸。

另外确认：`workers-ai-provider` 确实在 think 的 dependencies 里（不是 peer），
所以「返回模型 id 字符串即可，不用另装 provider」这条是真的。
tsconfig 只需要 `{"extends": "agents/tsconfig"}`。

**验收方式**：`vite dev` 起服务，Playwright 打开真页面、真发一条消息，
断言模型返回且内容体现读到了 system prompt（它答出了「通过共享项目公共文件区和
@提及协作，不直接聊天」）。控制台 0 错误 0 警告。
不是只看 tsc 过就算通 —— Task 1 是硬闸口，必须真调通模型。

---

## [2026-08-29T12:25:51.801Z] · deviation · claude-code
**run_worker_first 数组形式会让鉴权只覆盖列出的路径**

**症状**：Access 鉴权中间件写在 `fetch` 入口最前面，本地开发正常，
部署后 `/` 返回 200 并正常吐出 index.html，`/assets/*.js` 也是 200，
只有 `/agents/*` 返回 500。

**根因**：`wrangler.jsonc` 里 `assets.run_worker_first` 写成了 `["/agents/*"]`。
数组形式的含义是「只有匹配的路径路由到 User Worker」——
**其余路径由 Asset Worker 直接服务，User Worker 根本不执行**。

所以任何写在 fetch 入口的中间件（鉴权、限流、审计日志）都只对数组里列出的
路径生效，对其他路径完全不存在。这一点在配置里看不出来，
`run_worker_first` 这个名字听起来像"先跑 Worker"，实际是"这些路径才跑 Worker"。

**修法**：
- `run_worker_first: true`（布尔，全部路径）
- 加 `assets.binding: "ASSETS"`，`wrangler types` 会生成 `ASSETS: Fetcher`
- Worker 在鉴权通过后调 `env.ASSETS.fetch(request)` 转发静态资源

**验证**：重新部署后实测五条路径（`/`、`/index.html`、`/assets/index-*.js`、
`/agents/agentdo/ferrule`、一个不存在的路径）全部返回 500。

**这个 bug 只有部署后才会暴露** —— 本地 `vite dev` 下静态资源走 vite 自己的
中间件链，所有请求都会经过 Worker，看不出差别。**不要靠本地开发验证鉴权覆盖面。**

---

## [2026-08-30T16:14:49.557Z] · deviation · claude-code
**Task 3：project 工具改用 beforeTurn 注入，不能挂 getTools**

**计划里 Task 3 Step 4 写的是把 project 工具挂在 `getTools()` 上，
用 `this.currentProjectId()` 取当前 project。实现时发现这个设计是错的，已改。**

两个原因：

1. **`getTools()` 没有参数**，拿不到任何上下文。文档确认签名是 `getTools(): ToolSet`。

2. **更根本的：agent 同时待在多个 project 里。** `Session = Agent × Project`，
   一个 agent 在 5 个 project 里就有 5 条 session。"当前是哪个 project"
   是**每一轮对话**的属性，不是 agent 的属性。任何挂在 agent 上的
   `currentProjectId` 字段都表达不了这件事，Task 4 一定会推翻它。

**正确做法：`beforeTurn(ctx)`。**

文档里 `TurnContext` 有 `body: Record<string, unknown>`（客户端请求的自定义字段），
返回的 `TurnConfig.tools` 说明是 "Extra tools to merge (**additive**)"。所以：

```ts
beforeTurn(ctx: TurnContext): TurnConfig | void {
  const projectId = ctx.body?.projectId;
  if (typeof projectId !== "string" || !projectId) return;
  const stub = this.env.ProjectDO.get(this.env.ProjectDO.idFromName(projectId));
  return { tools: projectTools(stub, this.name) };
}
```

没带 projectId 就是 DM —— 只有私有盘，没有公共区工具。这个降级是对的，
不是缺陷。

**顺带确认的合并顺序**（文档 tools.md）：
workspace 内置 → `getTools()` → 扩展 → session → skill → MCP → 客户端，
**后者覆盖先前**。所以自定义工具跟内置八个之一同名会静默顶掉它，不报错。
已加自动化断言防这个。

---

## [2026-08-30T17:31:46.452Z] · design-decision · claude-code
**Think 一个 DO 一条 session，对象模型改成三类 DO**

**Think 每个 DO 只管一条 Session**，在 `onStart` 时 `configureSession` 配置一次，
之后不能切。它的类型定义和全部文档里，`SessionManager`、`sessionId`、
`switchSession` 一次都没出现 —— `SessionManager` 是 `agents` 包给朴素 `Agent` 的，
Think 不用它。

原设计「一个 Agent DO 装很多条 session」因此无法实现。两条出路：

- **A** 一个 DO 对应一个 (agent, project) 对，共享的身份/记忆另起一个 DO
- **B** 放弃 Think，改用朴素 Agent + SessionManager

**选了 A**。B 会丢掉 agentic loop、流式、断流恢复、八个 workspace 工具、
context blocks —— 整个项目就建在这些之上，为保一个字段把地基换掉不划算。

**A 的形态：**

| DO | 每个什么一份 | 装什么 |
|---|---|---|
| `AgentIdentityDO` | 每个 agent | 身份卡、身份文档(soul)、记忆(memory) |
| `AgentDO` | 每个 (agent × project) | Think 会话、私有草稿盘 |
| `ProjectDO` | 每个 project | 文件、成员、索引、活动 |

DO 实例名 `${agentId}:${projectId}`，DM 用保留字 `dm`。**`Session = Agent × Project`
于是在基础设施层面字面成立** —— 不需要另造 sessionId，实例名就是 session 的身份。

跨 project 共享靠 `configureSession` 的 context provider：`soul` 和 `memory`
两个 block 的 `provider.get` 指向 `AgentIdentityDO`。这两个 provider 本来就是
为这种事设计的。

**代价**：agent 的私有草稿盘从「每 agent 一块」变成「每 session 一块」。
判断是改进而非退让 —— agent 在 A 项目的草稿本来就不该污染 B 项目。

**连带的一个改进**：`beforeTurn` 里 project 改从 DO 实例名取，不再读
`ctx.body.projectId`。客户端伪造不了实例名但能伪造 body ——
走实例名等于把「这条 session 属于哪个 project」变成路由层的事实，
而不是一个可以被请求方声称的值。

**要注意的副作用**：`configureSession` 一旦加了 context block，
Think 就用它们组装 system prompt，**不再调 `getSystemPrompt()`**。
人格的唯一来源变成 AgentIdentityDO 里那份文档，`getSystemPrompt()` 成了死代码。

---

## [2026-08-31T03:20:10.517Z] · resolution · claude-code
**乐观并发验证通过：模型撞上 stale 会基于新内容重做，不是盲目重发**

**整个设计里赌得最大的一件事，验证通过了。**

赌的是：`writeProjectFile` 返回 stale 之后，模型会**基于返回的新内容重做**，
而不是报错放弃、也不是把手里那份旧内容盲目重发。单元测试证明不了这件事 ——
它能证明 ProjectDO 返回了正确的 stale 结构，证明不了模型读懂了它。

**验证方法（确定性可复现，不靠时序运气）：**

把"agent 思考期间文件被改了"摊到两轮对话之间：

1. 播种 `pricing.md` = "专业版 100 元/月"（v1）
2. 第一轮：让 agent 只读不写。它报告 v1
3. 从后台把文件改成 v2，内容追加一行"团队版 300 元/月"
4. 第二轮：让 agent 把专业版价格改成 150，用它读到的版本号写回

**关键判据不是"它有没有重试"，而是"重试得对不对"**：
最终内容里那行"团队版"还在不在。在 = 基于新内容重做；没了 = 盲目重发旧内容。

**结果（模型 `@cf/moonshotai/kimi-k2.7-code`，Workers AI）：**

```
版本 3
专业版 150 元/月
团队版 300 元/月
```

三条全过：价格改了、团队版那行保住了、版本推进到 3。

**它对人说的话同样重要：**

> 被其他 agent 更新了，当前版本号是 2，内容多了团队版。
> 我基于最新内容把专业版改成 150 再写回。已更新，pricing.md 当前版本号：3。

没有把冲突当失败上报，自己处理完顺带说明发生过什么。这正是设计要的形态 ——
对照 youware 那张三路对比 + merge gate 的界面：同一件事，一个要人动手，
一个只要人知道。**这一组对比是 demo 里最有说服力的东西。**

**推论**：`writeProjectFile` 那段 description（明确写了"stale 不是错误"、
"在返回的 content 基础上重做"、"不要放弃也不要当失败上报"）是有效的，
不要在后续重构里精简掉。已有测试断言它包含"stale"和"重做"。

验证用的 `src/dev-routes.ts` 已删除，`server.ts` 里的 DEV 守卫也一并移除，
`grep -rn "dev-routes|handleDevRoute|__dev" src/` 确认零残留。
Task 10 要复现这个演练时，用那时会有的 seed 脚本，不要再开 HTTP 后门。

---

## [2026-08-31T06:26:02.663Z] · design-decision · claude-code
**WorkspaceDO：第四类 DO，按人记账**

Task 8 需要左栏列出「我的项目」和「我的 agent」，但对象模型里没有能回答这个问题的地方：
`ProjectDO` 和 `AgentIdentityDO` 都按名字寻址，知道名字才能拿到实例，跨 DO 查不出集合。

加了 `WorkspaceDO`（migration v3），一个人一个实例，实例名是 Cloudflare Access 验过的邮箱。
不另造 userId —— 鉴权已经给出唯一身份，再发一个 id 只会多一张要对齐的映射表。

它只记「有哪些」（project id + 名字、agent id），不记「是什么」。名字、简介、头像留在
`AgentIdentityDO`：抄一份到工作台就会漂，而两处不一致时界面显示哪个都是错的。

这不是投机 —— 左栏没有它就画不出来。但它确实是 spec 和 plan 里都没有的第四类 DO，
记在这里以免后来的人以为对象模型只有三类。

顺带的安全后果：`projectId` 是可猜的 slug（`pricing`、`sea-saas`）。`/api/projects/:id` 的
读写都先查这个 project 在不在调用者自己的工作台里，不查的话任何登录用户改一下 URL
就能读到别人的 project。这条有测试守着（`__tests__/do/api.test.ts`「读不到别人工作台里的 project」），
反事实验过：去掉归属检查那一条立刻红（expected 200 to be 404）。

---

## [2026-08-31T06:26:35.622Z] · deviation · claude-code
**界面四处不照搬设计稿**

Paper 上 `project overview` / `files · 完整列表` / `activity · 完整流` 三张稿实现时有四处没照搬。
都不是偷懒，是照搬会让界面说出跟产品主张相反的话，或者说出假话。

**1. 人类不给照片，给首字母盘。** 设计稿里 yrzhe 是一张真人头像，agent 是插画徽记。
一张真人照片在一列插画里永远是最抢眼的那个 —— 成员表第一行就把「人在协作、agent 是工具」
的老结论读回去了，而这个产品整件事就是要否定这句话。人类给一个安静的灰底首字母盘。

**2. 去掉 agent 的在线状态点。** 设计稿里 Ferrule / Verdigris 是绿点、Sable 是灰点。
后端没有任何东西能驱动它：要知道「这个 agent 此刻在不在干活」，得挨个问它在每个 project
里的 AgentDO。一个永远亮着的绿点是假的，而假的状态指示器正是让 demo 露馅的东西。

**3. 去掉文件夹、上传、新建文件夹。** 设计稿的文件 tab 有「交付物」「素材」两个文件夹和
两个按钮。后端的 `files` 表是平的，路径就是主键，没有目录概念。画一个点不动的按钮比不画更糟。

**4. `rejected` 那一行的措辞改了。** 设计稿写的是「Ferrule 重做了一次写入 — 文件已被改动 /
基于 v2 重读后写成 v3」。但活动记录发生在**拒绝的那一刻**，那时重做成没成功还不知道。
改成「Ferrule 的写入撞上了别人的改动 / 手上是 v1，公共区已经是 v2」，重做本身作为紧随其后的
一条 `updated` 出现 —— 两行连读反而比一行断言更能说明发生了什么。

同时把 `ProjectDO.writeFile` 存的 detail 从 `base 1 vs current 2`（一句给人看的英文残句）
改成 `v1→v2`，让界面自己拼中文。

---

## [2026-08-31T06:27:10.590Z] · design-decision · claude-code
**session 索引的写入方与标题时机**

`session_index` 表从 Task 4 建好起就没有任何写入方 —— 表是死的，中栏永远是空的。
Task 8 补上，顺带定了两件事。

**标题只在第一轮定一次，存在 AgentDO 自己的 storage 里。**
`TurnContext.messages` 文档里明写是 truncated + pruned 的，晚一点第一条用户消息会掉出窗口，
那时再取标题会取到对话中途的某句话。所以第一轮取到之后存进 `agentshow:sessionTitle`，
以后每轮都上报同一个值。存在 AgentDO 而不是每轮回 ProjectDO 读：这个 DO 就是这条 session，
标题是它自己的属性，而且省一次跨 DO 往返。

没有改 `upsertSession` 的语义（显式给标题就覆盖）—— 那样会和
`__tests__/do/project-members.test.ts` 里「换了个标题」那条测试冲突，
而「标题可改」本身是对的，只是这个调用方不该每轮改。

**被 @ 唤醒的 session 在 `notifyMention` 里定标题。**
不定的话，标题会从拼给模型的那段提示里截出来，会话列表上就是
「ferrule 在文件 pricing-table.tsx …」这样一行截断的机器话。改成 `被提及 · <路径>`。

**status 永远是 `in_progress`。** 设计稿里有「已完成」，但后端没有任何东西会把它置成 done ——
需要一个 agent 主动调用的 `completeSession` 工具（`ActivityVerb` 里已经留了 `completed`）。
没做，因为 Task 8 的范围是面板。界面照数据渲染，所以现在只会显示「进行中」，不假装。

---

## [2026-08-31T06:27:10.686Z] · tradeoff · claude-code
**右栏 4 秒轮询，不做推送**

右栏是一次性快照，而 agent 干活是异步的：它写文件、留评论、@别人都发生在推理过程中。
不轮询的话，演示时每一步都要手动刷新才看得见 agent 做了什么 —— 那正好毁掉「全程可见」这个卖点。

现在 4 秒轮询一次 `/api/projects/:id`。

**代价**：每个开着的浏览器每 4 秒一次 DO 读，而且它读的是整个 project 的快照
（成员 + 文件 + 评论数 + 50 条活动 + session 列表）。单人演示无所谓，多人常驻会是笔真开销。

**为什么不用 WebSocket 推**：`routeAgentRequest` 的 WS 是 agent 会话的通道，
ProjectDO 不是 Agent，没有现成的推送面。给它加一条推送链路（DO 之间的订阅 + 一个新的 WS 端点）
是真的工程量，而它解决的是一个演示阶段还不存在的问题。

**什么时候该换掉**：出现第二个人同时看同一个 project 的时候。那时轮询的浪费会随人数线性涨，
而且两个人看到的活动流会差最多 4 秒 —— 协作场景里这个差值开始有意义。

---

## [2026-08-31T06:27:35.047Z] · deviation · claude-code
**三个写端点从 Task 10 提前到 Task 8**

Plan 把三个写端点放在 Task 10 的 `scripts/seed.ts` 里。Task 8 提前做了，因为
Task 8 Step 5 是「人工过一遍界面」—— 没有 project、没有 agent、没有成员，界面上没有任何东西可看，
这一步根本执行不了。

提前的是 `POST /api/projects`、`POST /api/agents`、`POST /api/projects/:id/members`。
它们不是演示脚手架，是产品本来就需要的三件事，Task 10 的 seed 脚本改成调它们即可，不会重复实现。

**没做的**：这三件事的界面入口。设计稿里的「新对话」「我的 Agent」「管理」「+」目前都不可点。
剧本七步里没有一步需要从界面建 project 或建 agent，所以按 plan 的范围留着。

顺带清掉：`writeFile` 里一段绕了运算符优先级的垃圾表达式
`detail: c.anchor ?? null ? c.anchor : undefined`，结果碰巧对但没人能一眼看懂，改成 `c.anchor`。

---

## [2026-08-31T06:28:24.399Z] · resolution · claude-code
**更正：那段垃圾表达式不是 Task 8 清的**

上一条「三个写端点从 Task 10 提前到 Task 8」的末尾说 Task 8 顺带清掉了
`detail: c.anchor ?? null ? c.anchor : undefined`。两处不准，更正如下。

- 它在 `addComment`，不在 `writeFile`。
- 它不是 Task 8 清的。`git log -S 'c.anchor ?? null ?' -- agentshow/src/project.ts` 没有任何命中，
  说明这段表达式从未进过一次提交 —— 是 Task 7 提交前就改掉的，Task 8 没碰它。

当前状态（`agentshow/src/project.ts:218`）是 `detail: c.anchor`，正确。

---

## [2026-08-31T07:24:33.329Z] · deviation · claude-code
**文件详情不画版本历史和打开**

Task 9 的设计稿 `file detail · 讨论线程`（Paper `agentshow` / 界面稿）里，标题栏右侧有
「版本历史」和「打开」两个按钮。两个都没做。

**版本历史做不了**：`files` 表只有 `content` 和 `version` 两列，存的是**当前**内容。
没有历史表，v1 的内容在写 v2 的那一刻就没了。要做需要另建一张 `file_versions`，
不在 Task 9 范围内，也不在剧本七步里。

**「打开」没有可打开的东西**：产品里没有编辑器，文件的写入方是 agent 的
`writeProjectFile`。

按 Task 8 定下的同一条规矩处理：**点不动的按钮比没有按钮更糟**，所以不画。
这是这份设计稿第三次出现「后端没有的功能」（前两次是文件夹和上传），
说明设计稿是按完整产品画的，而当前范围是剧本七步 —— 后面每张稿都要按这条筛一遍。

---

## [2026-08-31T07:24:33.412Z] · tradeoff · claude-code
**anchor 保持自由文本，靠正则认行号**

`commentOnProjectFile` 的 anchor 是自由文本，工具说明里给的例子是「第 42 行」。
Task 9 加了 `parseAnchor()`：认得出行号就高亮对应的行，认不出就只当标签显示。

**为什么不把它改成结构化字段**（比如 `{from, to}`）：anchor 也可能是「整体」
「表头那一块」这种指不到行的说法，而那些同样是有用的定位。改成结构化就等于
强迫模型在「说不清位置」时要么撒谎要么放弃标注。

**代价**：正则解析模型自由生成的中文。实测 Verdigris 五条评论产出的是
「第 4 行」「第 1 行」「第 9 行」「第 9-26 行」，全部命中 —— 因为工具说明里
给了例子，模型照抄格式。但这是**约定，不是保证**：换个模型或改了那段说明，
命中率就会变。认不出时的表现是「不高亮」，不是报错，所以退化是安静的。

同时让人也能写 anchor：点代码里的一行就填进输入框，格式和模型写的一样，
于是两边的锚点能互相认得。原本 anchor 是只读的 —— agent 能写，人只能看。

---

## [2026-08-31T07:25:14.678Z] · design-decision · claude-code
**一条假绿的测试：夹具决定断言有没有区分度**

写身份卡测试时先写了这一条：

    expect(card.projects.map(p => p.projectId)).toEqual(["pricing"])

它通过了。反事实一验（把 `all.filter((_, i) => membership[i])` 换成 `all`）——
**仍然通过**。因为那个测试文件里只建过一个 project，「列出它所在的 project」
和「列出我的全部 project」两种实现给出的答案完全一样。

修法是在断言前补一个 Ferrule 不在的 project：

    await post("/api/projects", { projectId: "sea-saas", name: "SEA SaaS 调研" });

再验反事实就红了：`expected [ 'pricing', 'sea-saas' ] to deeply equal [ 'pricing' ]`。

**教训不是「要写反事实」，是「断言的区分度取决于夹具」**。一条断言只有在
「正确实现」和「合理的错误实现」会给出不同答案时才有意义。单元素集合上的
过滤逻辑几乎永远测不出来 —— 同类陷阱还有：只有一个成员时测排序、只有一种
kind 时测分类、只有一个版本时测版本比较。

这条留在这里是因为它不会自己暴露：假测试和真测试在报告里长得一模一样，
都是一行绿色。

---

## [2026-08-31T08:36:37.398Z] · design-decision · claude-code
**dev 开着跑测试会静默丢掉全部 DO 测试**

`vite dev` 开着的时候跑 `npx vitest run`，**workers 那个 project 会整个消失**，
只剩 node 组：

    Test Files  4 passed (4)      ← dev 开着
    Tests      35 passed (35)

    Test Files  13 passed (13)    ← dev 关掉后同一条命令
    Tests     101 passed (101)

两者都**退出码 0**，都打印一行绿色的汇总。没有警告，没有 skip 标记 ——
消失的 9 个文件 66 条测试不会在输出里留下任何痕迹。

原因（推测，未深挖）：`@cloudflare/vitest-pool-workers` 和 `vite dev` 都要起
workerd，`vite dev` 占着的时候后者起不来。

**为什么值得记**：这条命令是每个 Task 的提交门禁。在开着 dev 调界面的时候
顺手跑一遍测试是最自然的动作，而那一遍恰好把所有 Durable Object 测试
静默跳过了 —— 于是「测试全绿」变成一句假话，而且是看起来完全正常的假话。

**做法**：提交前那一次 `vitest run` 必须在 dev 关掉的情况下跑，并且**核对
文件数**（当前应为 13），不要只看颜色。

---

## [2026-08-31T08:45:40.238Z] · deviation · claude-code
**seed 加第三个 agent —— 计划的冲突步骤自相矛盾**

计划 Task 10 Step 3 写的是「让两个 agent 同时改同一文件」，但 Step 1 只 seed 两个 agent：
一个写实现，一个复审，而复审那个的人设第一条就是「从不改别人的文件」。
**按计划 seed 出来的团队里只有一个写手，这一步无法执行。**

加了第三个 agent（Sable，管文案）。选它的理由不是凑数，是撞车要有真实动机：
Ferrule 管结构、Sable 管文案，而定价组件里这两样住在同一个文件里。
两个人为了各自正当的理由去改同一个文件 —— 这才是乐观并发要解决的那种冲突。
如果靠人为编排（比如让复审 agent 破例改一次代码），演示时一看就是摆拍的，
而且要求模型违背自己的身份文档，多半会被它拒绝。

**实测结果**（本地 dev，Workers AI，两条 @提及并发投出）：

    rejected   sable    v1→v2
    updated    ferrule  v2
    updated    sable    v3      ← 重做

判据不是「有没有重试」，是**先写的那个人的改动有没有在 v3 里活下来**。
查过 v3 内容：Ferrule 加的 `aria-pressed` / `aria-label` / `role=` 全在，
同时 Sable 的中文文案（个人版 / 团队版 / 企业版、月付 / 年付）也在。
它是在新结构上重做，不是拿旧快照覆盖。

Sable 自己的推理（原文）：
「The previous write failed due to stale. The current version is 2, and someone
(probably Ferrule) added role and aria-pressed to the billing cycle toggle.
I shouldn't overwrite that structural change; I should just apply my copy edits
on top of the current version.」

这是整个计划里风险最高的一条假设，现在有了第二次独立验证
（第一次是 Task 2 之后用注入版本的方式验的，那次是构造的；这次是真并发）。

---

## [2026-08-31T08:46:36.313Z] · open-question · claude-code
**DO 命名空间是全局的 —— 多人时会撞车**

`ProjectDO` 按 `idFromName(projectId)` 寻址，`AgentIdentityDO` 按 `idFromName(agentId)`。
**这两个命名空间是全局的，不按人隔离。** 建 project `demo` 时踩到了：
它带着 Task 3 那次冲突验证留下的 `pricing.md v3` —— 同一个 id 就是同一个实例。

推论：如果两个人都登录（Access 放行 yrzhe.space / youware.com / arco.ai 三个域），
各自建一个叫 `demo` 的 project，**他们会共用同一个 ProjectDO**，看到彼此的文件。
agent 同理：两个人各建一个叫 `ferrule` 的 agent，会共用同一份 soul 和 memory。

**今天不会真的漏。** 已验证：`/api/projects/:id` 先查这个 project 在不在调用者
自己的工作台里，别人读不到（`__tests__/do/api.test.ts` 有测试，反事实验过）。
而且界面上没有任何创建入口，只有 seed 脚本能建 —— 所以要撞上，得两个人各自
拿着脚本、恰好用同一个 id。

**这是 layer 3（多人）的问题，spec 已经把多人放在第三层。** 记在这里是因为
它不会自己暴露：单人用永远正常，第二个人进来的那天才会安静地共享数据。

修的话大致是给 DO 实例名加上所有者前缀（`${owner}/${projectId}`），
连带 `agentKey` 和提及路由都要用带前缀的 id。不在 v1 范围内，没做。

---

## [2026-08-31T15:48:23.349Z] · design-decision · claude-code
**DO 实例名的分隔符不能用斜杠 —— 单元测试照不到跨层契约**

修 A-1 / A-2 时给 DO 实例名加所有者前缀，第一版分隔符用了 `/`：
`${owner}/${agentId}:${projectId}`。

**116 条测试全绿，tsc 零错，build 通过。** 然后浏览器里对话整个连不上。

agents SDK 把实例名**原样拼进 URL 路径且不编码**，斜杠于是变成真正的路径
分隔符。控制台里看得很清楚：

    GET /agents/agent-d-o/dev@localhost/ferrule:fixcheck/get-messages → 403
    WebSocket connection ... failed （连续 6 次）
    PartySocket: room name "dev@localhost/ferrule:fixcheck" contains forward slash

路由拿到的实例名只剩 `dev@localhost`，parseAgentKey 解析失败 → 403。
SDK 自己都警告了，而我的测试全都在 `agentKey()` / `parseAgentKey()` 这一层
自洽地往返，从来没经过 URL。

换成 `~`（RFC 3986 的 unreserved，不会被编码，slug 里也不会出现）之后，
控制台零 error 零 warning。

**教训不是「要测真机」——是「跨层的契约，单元测试是照不到的」。**
`agentKey` 的往返测试再多也证明不了「这个字符串能安全地当 URL 路径段」，
因为那个约束根本不在这个模块里，它在 SDK 怎么拼 URL 里。同类的还有：
能当文件名吗、能当 SQL 标识符吗、能进 HTTP header 吗、JSON 序列化后还相等吗。

顺带一条：我最初是用 curl 手工试的，而我自己在命令里 `quote(safe='')`
把整个名字编码了，于是看到的是 500 而不是 403 —— **测试用例本身引入的失真
差点把我引向错误的结论**（以为是 DO 侧解码问题）。真正说清楚的是浏览器控制台，
因为那是真实客户端自己拼的 URL。

---
