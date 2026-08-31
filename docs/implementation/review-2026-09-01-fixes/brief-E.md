# Lane E —— 这两条越权是真的关上了吗

先读 /tmp/agentshow-fixreview/CONTEXT.md。
worktree：/tmp/agentshow-fixreview/wt-E   输出：/tmp/agentshow-fixreview/out-E.md
完成后：touch /tmp/agentshow-fixreview/DONE-E

## 你的任务

**别信「已修」。** 拿 A-1 / A-2 的安全属性对着**修复后的代码**重新攻一遍，
而不是重跑上一轮那两条发现。

1. **绕过 `checkAgentRoute`。** 逐条想：
   - 路径大小写、尾斜杠、双斜杠、`.`/`..` 段、URL 编码（`%7E` 是 `~`、`%3A` 是 `:`）——
     `decodeURIComponent` 只解一次，双重编码会怎样？
   - `parts[1]` 取的是第二段。`/agents/x/y/z` 之外的形状呢？
     `parts.length < 2` 时返回 `not-agent` **直接放行**给 routeAgentRequest ——
     有没有一条实例名能塞进只有一段的路径里？agents SDK 还认哪些路由形状
     （去 node_modules/agents 里查真源码，别猜）？
   - WebSocket 升级请求走的是同一个 `fetch` 吗？确认握手也过闸。
   - `checkAgentRoute` 在 `handleApi` **之后**调用。有没有一条 `/agents/` 开头的
     路径会被 handleApi 先接走？

2. **命名空间还有没有漏网的站点。** 我自己 grep 过 `idFromName`，
   声称只剩两处合法例外（一处注释、一处 `WorkspaceDO.idFromName(email)`）。
   **独立复核这个声称**，并且扩大搜索面：`getAgentByName`、`get(` 直接传 id、
   `idFromString`、任何别的寻址方式；`scripts/seed.ts` 和测试里有没有绕过的路径。

3. **`~` 这个分隔符本身。** 邮箱里能出现 `~` 吗（查 RFC 5322 的 atext）？
   如果能，`a~b@x.com` 和某个别的组合会不会拼出同一个实例名？
   构造一次碰撞，或者证明构造不出来。
   同理 slug 正则 `^[a-z0-9][a-z0-9-]{0,63}$` 真的挡住了所有危险字符吗？

4. **旧数据。** 实例名变了，线上原来的 DO 实例还在，只是不再可达。
   这会不会留下任何可被利用的东西？（提示：`migrations` 没变、类名没变）

5. **DM 路径。** `projectId` 为 null 时 `beforeTurn` 直接 return，不注入工具。
   `agentKey(owner, id)` 生成 `${owner}~${id}:dm`。这条路上归属检查成立吗？

请**实际发请求验证**（起 `npx vite dev --port 5296`，dev 模式绕过 Access，
`access.email` 固定是 `dev@localhost`，正好用来验「进站之后能干什么」）。
报告里写明你实际发了什么、收到什么。跑完把 dev 关掉。
