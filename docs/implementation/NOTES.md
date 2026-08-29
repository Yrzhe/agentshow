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
