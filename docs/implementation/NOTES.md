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
