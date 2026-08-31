# Lane D —— 规格兑现、契约对齐、prompt↔数据流一致性

先读 /tmp/agentshow-review/CONTEXT.md（共享上下文 + 硬性要求 + 交付格式）。
worktree：/tmp/agentshow-review/wt-D     输出：/tmp/agentshow-review/out-D.md    代号：D

## 你的攻击面

你不找崩溃，你找**「代码全对但做的是错东西」**。三条轴：

### 轴一：兑现规格

先通读 `docs/architecture/agentshow-design.md`（spec）和
`docs/implementation/2026-08-29-agentshow-v1.md`（计划，含 Global Constraints），
再对照代码，逐条判：

- **漏了**：spec/计划要求但没实现的（引 spec 原文 + 说明代码里为什么没有）
- **多了**：spec 没要求却实现了的 scope creep
- **做错了**：看起来实现了但语义和 spec 不符
- **Global Constraints 有没有被违反** —— 那一节每条都是硬约束，逐条核实：
  版本钉死、模型走 Workers AI 不装 provider 包、自定义工具名不撞内置八个、
  `workspaceBash = false`、SessionManager 方法同步、只用 DO SQLite、
  不写「留给以后」的分支、每步提交前跑 tsc + vitest

### 轴二：跨边界契约逐字段对齐

producer ↔ consumer 每个边界都核**最坏输入**下发送方产生的值是否落在接收方约束内：

- 浏览器 → `handleApi`：`src/api.ts` 里所有 zod `.max()` / `.min()` / 正则，
  逐条回溯前端有没有对应的截断或校验。前端「能发」不等于服务端「肯收」。
  重点：`src/ui/FileDetail.tsx` 的 Composer 发的 `text` / `message` 有没有长度上限？
  `AddComment` 的 `anchor` 是 `.max(80)`，前端点行号生成的 anchor 会不会超？
- agent 工具调用 → `ProjectDO`：`src/agent-tools.ts` 的 zod schema
  vs `src/project-schema.ts` 的表约束。模型能产生的最长 path / content 是多少？
  `writeProjectFile` 的 content 没有长度上限，DO SQLite 的行大小限制是多少？超了会怎样？
- `api-types.ts` 声明的形状 vs `api.ts` 实际返回的 —— 有没有字段声明了但某条路径不填？

### 轴三：prompt ↔ 数据流一致性（**这一轴最重要，请花最多时间**）

`src/agent-tools.ts` 里的 tool description 和 `scripts/seed.ts` 里的 soul 文档
**都是 prompt** —— 它们对模型做出承诺。逐句把承诺回溯到真实的数据/能力：

- **可达性**：prompt 让 agent 做的事，它真的有工具能做吗？
  实锤线索：`mentionAgent` 的 description 写着「如果返回 unknown_agent……
  先用 listProjectFiles 之外的方式确认名字」—— agent **有没有**任何工具能列出成员名字？
  去 `PROJECT_TOOL_NAMES` 和 Think 内置的八个工具里找。找不到就是 prompt 在骗模型。
  同样地，seed 里的 soul 让 agent 做的每件事，逐条确认它有对应的工具。
- **保留**：prompt 教 agent 产出的东西，在链路里有没有被丢掉/截断？
  `writeProjectFile` 返回的 `{ok:false, reason:"stale", content, version}` ——
  那个 `content` 完整地进了模型的上下文吗？还是在某处被截断？
  （这条决定乐观并发成不成立，请追到底）
  `notifyMention` 拼给被叫醒 agent 的那段文字（`src/server.ts`），
  它承诺的信息在 `TurnContext` 里真的都在吗？
- **soul 与工具矛盾**：`scripts/seed.ts` 里 Verdigris 的 soul 说「从不改别人的文件」，
  但它的工具集里**有** `writeProjectFile`。这是不是一个只靠 prompt 维持的约束？
  同理 Sable 说「只改文案不改结构」。这些约束的强度如何，失效会怎样？

### 轴四：注释/文档承诺 ↔ 实码行为

grep 代码注释里的行为承诺词：「原子」「一定」「永远」「只」「不会」「幂等」「上限」，
逐条对实码验真。这个仓库的注释密度很高且都在解释「为什么」—— 
**注释撒谎是最深的陷阱**，因为代码「看起来对」全靠注释背书。

CHANGELOG.md 和 NOTES.md 里的声明也算承诺，一样核。
