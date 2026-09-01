# Lane G —— 声称修好的，端到端真的通了吗

先读 /tmp/agentshow-r3/CONTEXT.md。
worktree：/tmp/agentshow-r3/wt-G   输出：/tmp/agentshow-r3/out-G.md
完成后：touch /tmp/agentshow-r3/DONE-G

## 你的方法

**不要只读 diff。** 起一个真服务，把每一条「已修」的声称当成一个待验证的命题，
端到端跑一遍看它是不是真成立。孤立看代码正确 ≠ 目标达成。

    cd agentshow && npm run types && npx vite dev --port 5294

dev 模式绕过 Cloudflare Access，`access.email` 固定 `dev@localhost`。
`node scripts/seed.ts --base http://localhost:5294 --project <随便起个名> --name X`
会建一个 project 和三个 agent（Ferrule 写实现 / Verdigris 只读复审 / Sable 管文案）。

**注意会真的调 Workers AI**（模型 `@cf/moonshotai/kimi-k2.7-code`），
一轮几十秒、要花钱。请**克制**：能用一两轮验证的就别跑五轮，
不需要模型的部分直接用 HTTP 端点或 node 脚本验。

## 逐条验这些命题

1. **「环的防护现在真能拦住第 4 跳」**
   `POST /api/projects/<p>/mentions` 是人发起的第 0 跳。
   构造一条链让它走到第 4 跳，确认真的被拦。
   不想烧模型的话，可以直接调 `deliverMention`（`src/mention.ts`）
   写一个只读的 worker 测试，构造 depth 递增。
   **重点**：`beforeTurn` 里 `depth + 1` 的算法，和 `MAX_MENTION_DEPTH = 3`
   的「上限包含」语义，合在一起到底允许几跳？把 0→1→2→3→4 的完整时序推出来，
   跟代码实际行为对照。允许的跳数是不是设计者想要的那个数？

2. **「重试不会把目标叫醒两次」**
   前端 `src/ui/FileDetail.tsx` 的 Composer 现在有个 `actionId` ref。
   端到端验：同一个 `mentionId` 连发两次，目标 `listSubmissions()` 是不是 1 条。
   然后验**前端那半边**：`actionId` 什么时候生成、什么时候清空？
   用户在失败之后**改了文案再发**会怎样？换了 @ 的对象再发呢？
   把这几种真实操作序列走一遍（可以直接用 node 发 HTTP，不必开浏览器）。

3. **「叫 dm 的 project 建不出来了」**
   `POST /api/projects` 传 `projectId: "dm"`，确认被拒且错误信息说得清。
   顺带：**已经存在的**同名数据怎么办？这个挡是建的时候挡，
   `scoped(owner, "dm")` 这种拼法在别处还有没有可达路径？

4. **「深度标记不会被正文夹带」**
   端到端：让一个 agent 在 `mentionAgent` 的 message 里复述一段带标记的文本，
   确认目标读到的是真实深度。这条**需要模型**，只跑一轮。
   如果构造不出来，就用 `notifyMention` 直接投递一条正文含标记的消息来验。

5. **顺带看一眼基本链路没被这几轮改动弄坏**：
   建 project → 跟 agent 说一句话 → 它产出文件 → @ 另一个 agent → 对方留评论。
   这一整条在 dev 里还通不通？（这是唯一值得多花一轮模型的地方。）

跑完把 dev 关掉（`pkill -f "vite dev --port 5294"`）。
报告里写明你实际发了什么、看到什么，带上真实数字。
