## [HIGH] `MAX(depth)` 把同一 agent 的独立链合并，合法短链会被长链压死
**证据**：源 `agentshow/src/project.ts:182-190` ↔ 目标 `agentshow/src/mention.ts:74-76`

**失败场景**：A 在 15 分钟内先后收到两条互不相关的提及：人直接 @ A 记为 depth 0，另一条长链 @ A 记为 depth 3。A 处理人的短链并 @ B 时，`lastMentionDepth("a")` 不知道当前轮属于哪条链，只能返回窗口内的 `MAX=3`；`deliverMention` 因而算出 4 并返回 `max_depth`。这条短链按因果关系应为 depth 1，却没有投递。临时 worker 测试实测写入 `[0, 3]` 后结果为 `{ ok:false, reason:"max_depth" }`。

**建议**：账本必须记录并沿服务端不可伪造的当前 submission/turn 身份追踪链，例如 `mention_id + parent_mention_id/chain_id`；下一跳只读取唤醒当前轮的那条记录。不要再用 `(agentId, 时间窗)` 聚合来猜当前因果链。

## [HIGH] 目标先持久化接收、ProjectDO 后记账，失败重试会永久留下「已投递但无 hop」
**证据**：源 `agentshow/src/server.ts:120-133` ↔ 目标 `agentshow/src/mention.ts:99-107`

**失败场景**：`notifyMention` 先返回 `accepted=true`，目标已经持久化一轮；随后 `Promise.all` 中 `recordMentionHop` 失败，调用方收到异常。调用方复用原 `mentionId` 重试时，目标返回 duplicate，`deliverMention` 在第 102 行提前返回，不再补 hop 或核对 activity。故障注入实测：第一次接受后 hop 写失败，原 ID 重试结束时 `notifyCalls=2, hopRows=0, activityRows=1`。账本因此少算一跳，且正常重试无法自愈。

**建议**：给 ProjectDO 账本增加唯一 `mention_id` 和可恢复状态。目标的 accepted/duplicate 都应进入同一个幂等 finalize/upsert 路径：缺 hop/activity 就补齐，已经齐全才直接返回 duplicate。不要让 duplicate 在账本核对之前提前返回；hop 与 activity 应在 ProjectDO 的一次事务中原子落地。

## [LOW] `mention_chain` 永久只增不删，查询虽命中索引但存储没有上界
**证据**：源 `agentshow/src/project-schema.ts:64-70` ↔ 目标 `agentshow/src/project.ts:194-200`

**失败场景**：每次 accepted 都无条件插入一行，仓库内没有 `DELETE FROM mention_chain` 或其他清理入口；15 分钟之外的行不参与深度，却永久占存储。临时 worker 测试插入 5000 条一小时前的行和 7 条当前行后，总数仍为 5007。`EXPLAIN QUERY PLAN` 为 `SEARCH mention_chain USING INDEX mention_chain_by_target (to_agent_id=? AND at>?)`，所以当前查询会用 `(to_agent_id, at)` 范围索引，但这不解决累计存储增长。

**建议**：保留略大于 15 分钟窗口的明确 retention，并在受控路径按 target 分批删除过期行；同时加覆盖长期增长和清理后边界记录仍可见的测试。

## [LOW] 工具会返回 `max_depth`，但模型说明只告诉它如何处理 `unknown_agent`
**证据**：源 `agentshow/src/mention.ts:49-54` ↔ 目标 `agentshow/src/agent-tools.ts:110-125`

**失败场景**：A↔B 顺序实测为 depth `0,1,2,3` 放行，第 5 次返回 `max_depth`，目标没有再被唤醒；但 `mentionAgent` 的 description 没告诉源模型这是终止信号，也没要求不要换说法重试。不同说法会生成一次新的工具调用；虽然仍会在第 76 行被拦，不会再烧目标 agent，但可能继续消耗当前源模型的工具步。

**建议**：在 description 明确写出 `max_depth` 的终止语义：当前提及链已被服务端截断，不要改写消息、换目标或从当前轮重试，应停止转派并向用户报告。

## 判决
FIX-FIRST

实际验证：

- 临时 APFS 克隆中新增 2 个只用于复核的测试文件，未改 worktree。
- `npm run types` 后 `npm run typecheck` 通过。
- 定向 node 测试 1/1 通过；定向 workers 测试 4/4 通过。
- 完整套件 17 文件、130 条断言通过；其中复核新增 2 文件、5 条，原套件对应 15 文件、125 条。进程退出码 0；vitest 结束时另报 `close timed out after 10000ms`，未影响断言结果。
- `Promise.all` 两条不同人类来源、同一目标的 `deliverMention` 实测均返回 depth 0，最终 `mention_chain` 有两行 depth 0，没有丢行。现有并发问题不是 append 丢写，而是缺乏逐轮因果身份，以及跨 DO 接收/记账不能原子提交。
- 顺序 A↔B 实测结果为 `0, 1, 2, 3, max_depth`，顺序路径能在第 5 次尝试停住。
- 人类来源只写进 activity 的 `actor_id`；正常 `recordMentionHop.toAgentId` 来自只解析 agent 的 `resolveAgentByName`，未发现正常路径把人写入 `mention_chain`。

未覆盖：没有调用付费模型，因此 `max_depth` 后具体模型是否会重试只确认到工具契约缺少指导，没有观测真实模型行为；没有在真实 Cloudflare 故障/配额环境制造 ProjectDO 写失败，原子性发现使用可控故障注入复现；同毫秒边界按 `>=` 静态确认会包含，未在运行时模拟平台时钟回拨；未做长期负载或存储上限测试。
