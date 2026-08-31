# Lane A —— 并发、状态机、失败路径

先读 /tmp/agentshow-review/CONTEXT.md（共享上下文 + 硬性要求 + 交付格式）。
worktree：/tmp/agentshow-review/wt-A     输出：/tmp/agentshow-review/out-A.md    代号：A

## 你的攻击面

这个产品最核心的技术赌注是**乐观并发**：agent 干活是长事务，它脑子里的快照会在几十秒里
失效，所以写入带 baseVersion，不匹配就拒绝并把当前内容还给它，让它重做。
你的任务是把这套东西以及它周围的所有状态机往死里打。

具体查这些（不限于）：

1. **`ProjectDO.writeFile` 的乐观并发**（`agentshow/src/project.ts`）——
   version 从 0 起算对不对？`readFile` 返回 null 和 version 0 是否被混淆？
   owner_id 只在 INSERT 写、UPDATE 不碰，这个决定在哪些路径下会给出错误的归属？
   两个并发 writeFile 落在同一个 DO 上是否真的串行（DO 的输入门控在哪些情况下会打开）？

2. **@提及的深度计数**（`src/mention.ts` + `src/server.ts` 的 `notifyMention` /
   `currentMentionDepth` / `onChatResponse`）——
   深度存在目标 DO 的 storage 里，`onChatResponse` 清掉。
   问：A @ B 的同时 C 也 @ B，深度会不会互相覆盖？
   一轮里 agent 连续 @ 两个人，第二个拿到的深度对吗？
   `onChatResponse` 如果因为异常没跑到，下一轮人类请求会被当成第几跳？
   环的防护真的成立吗（构造一条能绕过上限的路径，或证明绕不过）？

3. **`submitMessages` 的幂等键**（`src/server.ts`）——
   键是 `mention:${fromId}:${path}:${message}`。
   同一个人在同一文件上先后说两次**同样的话**（合理场景：催一次）会怎样？
   这是想要的行为吗？

4. **session 索引的标题**（`src/server.ts` 的 `SESSION_TITLE_KEY` / `beforeTurn`）——
   `beforeTurn` 是异步的了，它在什么时机跑、失败会怎样？
   标题只写一次的实现，在「先被 @ 唤醒、后被人类对话」和反过来的两种顺序下分别是什么结果？

5. **`AgentDO.beforeTurn` 每轮都调 `project.upsertSession`** ——
   这是一次跨 DO RPC，放在每一轮的关键路径上。它失败会怎样？会不会把整轮推理带崩？

6. **活动流**（`project.ts` 的 `#record` / `#kindOf`）——
   `#kindOf` 对不在成员表的作者按 agent 兜底。构造一个这个兜底会给出错误答案的场景。
   `listActivity(50)` 的硬上限，在活动很多时前端会看到什么？

7. **`WorkspaceDO` 与 `handleApi` 的写路径**（`src/api.ts`）——
   建 project、拉成员这些操作不是原子的（多次 await 跨 DO）。中间失败会留下什么半成品状态？

请**实际跑测试**（注意 CONTEXT.md 里那个静默丢测试的坑），并在报告里写明你跑了什么、看到什么。
