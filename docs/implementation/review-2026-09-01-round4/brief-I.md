# Lane I —— 新机制自己的那个形状

先读 /tmp/agentshow-r4/CONTEXT.md。
worktree：/tmp/agentshow-r4/wt-I   输出：/tmp/agentshow-r4/out-I.md
完成后：touch /tmp/agentshow-r4/DONE-I

## 你的任务

前两版的深度机制各有一个「形状」被复审揪出来。**找 v3 的。**
重点在**并发**、**聚合语义**和**账本本身的完整性**。

1. **`lastMentionDepth` 用 `MAX(depth)`，窗口 15 分钟。**
   - 一个 agent 在窗口内被**两条不同的链**叫醒（比如人直接 @ 它 = 第 0 跳，
     同时另一个 agent 在第 2 跳上 @ 它）。它接下来发出的提及算第几跳？
     这是想要的吗？会不会让一条合法的短链被前一条长链压死？
     构造这个场景跑一遍。
   - `MAX` 是保守方向（宁可多算）。有没有一种真实序列会让它**少算**？
   - 窗口边界：`at >= Date.now() - windowMs`。同一毫秒、时钟回拨呢？

2. **读改写之间没有锁。**
   `deliverMention` 先 `lastMentionDepth`（读）→ 判断 → `recordMentionHop`（写）。
   两条提及**并发**投给同一个目标会怎样？
   Durable Object 的输入门控在什么情况下会打开（`await` 跨 RPC 时）？
   这两次调用之间隔着 `resolveAgentByName`、`memberName`、`notifyMention`
   三次跨 DO 往返 —— 期间别人能不能插进来？
   **构造一个并发场景实测**（`Promise.all` 两条 deliverMention），
   看最终 `mention_chain` 里的行和你推的一致不一致。

3. **账本完整性。**
   - `duplicate` 时**不记跳**。这对不对？如果第一次记过了，重投不记是对的；
     但有没有一条路径会「投递成功却没记跳」或者「记了跳但没真投递」？
     看 `src/mention.ts` 里 `Promise.all([recordMentionHop, recordMention])`
     和它前面那次 `notifyMention` 的关系 —— 中间失败会留下什么？
   - `mention_chain` 只插不删。长期跑下去多大？有没有清理路径？
     `lastMentionDepth` 的查询会不会随表增长变慢（索引是
     `(to_agent_id, at DESC)`，查询是 `WHERE to_agent_id = ? AND at >= ?` 的
     `MAX(depth)` —— 这个索引真的被用上了吗？用 `EXPLAIN QUERY PLAN` 确认）。

4. **环真的会停吗。**
   推一遍完整的 A↔B 时序：A→B、B→A、A→B、B→A…
   每一步 `lastMentionDepth` 查到什么、算出几、拦在第几次。
   写成一个 worker 测试实测（不需要模型，直接调 `deliverMention`）。
   **然后问：拦住之后会怎样？** `max_depth` 返回给工具，模型看到什么、
   会不会换个说法再试一次（`src/agent-tools.ts` 的 description 怎么说的）？

5. **人不是 agent。**
   `deliverMention` 用 `fromId` 查 `lastMentionDepth`。人的 id 是邮箱，
   人永远不是提及的目标，所以永远查不到 → 永远第 0 跳。
   **但是**：`recordMentionHop` 存的是 `toAgentId`。有没有可能人被写进去？
   `resolveAgentByName` 只解析 agent，但 `recordMention`（活动流那条）
   的 `fromId` 可以是人。两张记录的语义有没有混淆的地方？

请实际写只读的 worker 测试来验（`__tests__` 目录下的现有测试是范例，
但**不要修改仓库文件** —— 在 /tmp 下建你自己的副本跑，或者用
`npx vitest run --project workers` 配合临时文件后删掉）。
报告里写明你实际跑了什么、看到什么数字。
