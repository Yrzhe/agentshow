# Lane F —— 另外三条修复有没有半修或引入新问题

先读 /tmp/agentshow-fixreview/CONTEXT.md。
worktree：/tmp/agentshow-fixreview/wt-F   输出：/tmp/agentshow-fixreview/out-F.md
完成后：touch /tmp/agentshow-fixreview/DONE-F

## 你的任务

**重点找「修复引入的相邻类别新 bug」和「只修了一半」。**

1. **A-3 提及深度改成写进消息正文**（`src/mention.ts` 的 `depthLine`/`depthInText`，
   `src/server.ts` 的 `depthOf`）。攻这些：
   - `depthOf` 取的是**最后一条 user 消息**。多轮对话里，被提及那一轮之后
     用户又说了话，`ctx.messages` 里最后一条 user 是谁？深度会不会读错？
   - 模型自己在回复里复述那句话（**实测它真的会**：Ferrule 的推理里出现过
     "This is mention chain hop 0 of max 3"），会不会被 `depthOf` 读到？
     assistant 消息不算 user，但如果模型把它写进某个工具参数再回流呢？
   - `ctx.messages` 是**截断过的**。长对话里那条提及掉出窗口之后，深度变成几？
     这会不会让环的防护重新失效？**这条请重点查，给出具体的时序。**
   - 正则 `（这是提及链的第 (\d+) 跳，最多 \d+ 跳）` 用的是全角括号。
     用户手打半角、模型改写措辞、i18n 之后会怎样？
   - `depth + 1` 在 `beforeTurn` 里算。人类发起是 0，被 @ 的第一个 agent 读到 0 ——
     那它再 @ 别人是 1。跟 `MAX_MENTION_DEPTH = 3` 的语义对得上吗？
     真的还能拦住 A↔B 的环吗？**推一遍完整的四跳时序。**

2. **A-4 幂等键。** 改成每次动作一个随机 id 之后，**幂等还剩什么**？
   `deliverMention` 的 `mentionId` 默认是 `crypto.randomUUID()` ——
   那网络重试同一个 HTTP 请求会怎样？会不会变成「每次重试都真的叫醒一次」？
   `duplicate` 这个新返回值有没有调用方真的处理（查 `src/api.ts` 和
   `src/agent-tools.ts` 和前端）？还是又变成一个被丢弃的返回值？

3. **A-17 / A-18 前端。** `src/client.tsx`：
   - `currentProject` 是个 ref，在**渲染期间**赋值（`currentProject.current = projectId`）。
     并发渲染 / StrictMode 下这成立吗？
   - `stale` 只在 `reload` 的 catch 里置上，在 `then` 里清掉。
     `FileDetail` / `AgentCard` 自己的 fetch 失败仍然是各管各的（A-21 未修）——
     确认这不是我漏改的，而是范围外。
   - 那条 `stale` 提示是 `fixed bottom-3 left-1/2`，会不会盖住输入框或发送按钮？
   - `fatal` 只在首次 `/api/me` 失败置上。`/api/me` 成功但返回空 projects 呢？

4. **A-12 `upsertSession` 包了 try/catch。** `console.error` 之后继续 ——
   确认 catch 的范围没有顺带吞掉别的东西（那个 try 块里还有 storage 读写）。
   标题写入失败会怎样？

5. **回归。** `git diff 6b480e0..HEAD` 里有没有哪一处改动**顺手改坏了**
   原本正确的行为？特别看测试的改动：有没有把断言改松以迁就新实现？
   （`__tests__/agent-key.test.ts`、`__tests__/do/mention.test.ts`、
   `__tests__/do/api.test.ts` 都被改过）

请实际跑测试并**核对文件数是 14**。可以起 dev 亲眼看前端。
