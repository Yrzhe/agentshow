## BLOCKER Agent WebSocket 可绕过 Workspace 和成员关系，任意登录请求都能伪装 agent 写任意 project
**证据**：源 `agentshow/src/server.ts:188-203` ↔ 目标 `agentshow/src/server.ts:152-183`；对照 HTTP API 的归属闸 `agentshow/src/api.ts:232-235`
**失败场景**：已通过 Access 的调用方直接连接 `/agents/agentdo/ghost:pricing` → `routeAgentRequest` 只验证「已登录」，没有查询当前邮箱的 `WorkspaceDO`，也没有检查 `ghost` 是否属于 `pricing` → `beforeTurn` 仅从可控的 DO name 拆出 `agentId/projectId`，立即以 `authorId: "ghost"` 注入 `writeProjectFile`、评论和提及工具，并写入 session 索引 → 非成员能创建 owner 为 `ghost` 的文件、留下 agent 活动，若 Access 放行不止一个邮箱，还能跨 Workspace 读写同名 ProjectDO。定向测试实际构造 `ghost:review-a-project`：`hasMember("ghost") === false`，但拿到了 `writeProjectFile`，且 session 索引出现 `ghost`。
**建议**：在进入 `routeAgentRequest` 前解析并验证 AgentDO key：project 必须属于当前 Access email 的 Workspace，agent 必须属于该 Workspace 且是 ProjectDO 成员；不要把「实例名能被解析」当授权事实。由服务端生成/签发 session 地址会比在每轮工具层补检查更完整。

## HIGH 提及深度是 session 级单槽，排队或交叠的轮次会互相覆盖并绕过深度上限
**证据**：源 `agentshow/src/server.ts:94-124` ↔ 目标 `agentshow/src/server.ts:129-140,173-182`、`agentshow/src/mention.ts:42-44`
**失败场景**：A 以 depth=1 @ B，C 紧接着以 depth=3 @ B → 两条 `submitMessages` 都进入 FIFO，但它们的深度没有跟 submission 绑定，只反复覆盖同一个 `MENTION_DEPTH_KEY` → 如果两轮开始前都已入队，第一轮会读到 3、再提及时被当作第 4 跳拒绝；第一轮结束又删除这个共享键，第二轮会读到 0、再提及时被当作第 1 跳放行。若第二条在第一轮推理期间到达，第一轮的 `onChatResponse` 同样会删掉第二条刚写入的深度。定向测试实际得到 2 条 submission，但 storage 只剩最后写入的 depth=3。
**建议**：把 depth 绑定到每个 submission/turn，而不是 AgentDO 全局键；例如用 submissionId 建持久映射，在该 submission 的 `beforeTurn` 读取并在其终态清理。若 SDK 的 turn context 不能携带 submission metadata，就在消息中携带不可由模型改写的内部 envelope，或实现自己的 admission 队列。

## HIGH 内容拼出的永久幂等键会静默吞掉合理的重复提及，活动流却仍宣称投递成功
**证据**：源 `agentshow/src/server.ts:118-125` ↔ 目标 `agentshow/src/mention.ts:60-76`
**失败场景**：同一人稍后在同一路径再次发送同一句「请复审」 → `fromId:path:message` 与第一次完全相同，`submitMessages` 命中旧 submission 并返回 `accepted:false` → `notifyMention` 丢弃该返回值，`deliverMention` 仍调用 `recordMention` 并返回 `{ok:true}` → UI 新增一条「已提及」活动，但目标 agent 没有新一轮。定向测试连续调用两次相同业务提及，`listSubmissions()` 实际只有 1 条。原始字段也未转义，`path="a:b", message="c"` 与 `path="a", message="b:c"` 还能产生同键碰撞。
**建议**：由发起动作生成独立 mentionId，并只用该 ID 做网络重试幂等；同一业务动作的重试复用 ID，新的催办生成新 ID。检查 `accepted`，只有首次接受或明确确认同一动作已经持久化时才记录成功活动。

## MED Project 创建跨两个 DO 非原子，第二步失败会留下已授权但没有人类成员的半成品
**证据**：源 `agentshow/src/api.ts:209-224` ↔ 目标 `agentshow/src/api.ts:232-235,295-301`、`agentshow/src/project.ts:115-123`
**失败场景**：`workspace.addProject` 成功后，`ProjectDO.addMember` RPC 失败 → Workspace 已永久列出该 project，因此后续归属闸放行 → 用户可以继续 POST 评论；但成员表没有这个邮箱，`#kindOf` 对未知 actor 一律回退为 `agent` → 人类评论和活动被错误记为 agent，成员列表也缺创建者。重试创建能修复，但失败响应后的持久状态已经可观察。
**建议**：把 ProjectDO 初始化作为权威成功点，成功后再发布 Workspace 引用；若发布失败则允许幂等补偿。读取/写入时同时验证 ProjectDO 的人类成员关系，避免 Workspace 单边记录直接成为授权凭证。

## MED 展示用的 session 索引 RPC 是每轮推理的硬依赖，索引失败会阻断模型调用
**证据**：源 `agentshow/src/server.ts:160-167` ↔ 目标 `agentshow/src/project.ts:339-359`
**失败场景**：用户消息已经进入 AgentDO，`beforeTurn` 为刷新标题/updatedAt 调 `project.upsertSession` → ProjectDO RPC 短暂失败或目标 DO 不可用 → 未捕获异常从 `beforeTurn` 冒出，工具配置不返回，模型推理不开始；本来只影响中栏索引新鲜度的故障升级为整轮对话失败。每一轮都执行，所以已建立 session 也不能避开。
**建议**：将索引刷新改为可观测的 best-effort 投影，失败记录告警并让推理继续；首次建索引可在响应后重试/修复。若产品坚持强一致，则至少把失败转成明确可重试状态，并证明消息不会被卡死或重复执行。

## MED 全新检出直接跑规定的 typecheck 会失败，门禁依赖未声明的前置生成步骤
**证据**：源 `agentshow/package.json:6-12` ↔ 目标 `.gitignore:8-9`、`agentshow/src/env.d.ts:11-14`
**失败场景**：全新副本执行 `npm ci && npx tsc --noEmit` → 被忽略的 `worker-configuration.d.ts` 不存在，`Env` 只有两个 secret，没有 `AgentDO`、`ProjectDO`、`WorkspaceDO`、`AgentIdentityDO`、`ASSETS` 等绑定 → tsc 以大量 TS2339 失败；手动先跑 `npm run types` 后才通过。实现计划要求每步直接跑 `npx tsc --noEmit`，当前仓库不能复现这个门禁。
**建议**：让 `typecheck` 自己先运行 `wrangler types`，并让 CI/文档只调用该自包含脚本；或者提交稳定的绑定声明，避免正确性依赖本机残留的 ignored 文件。

## LOW 「活动完整流」实际永久截断在最近 50 条，前端没有分页或继续加载
**证据**：源 `agentshow/src/api.ts:100-113` ↔ 目标 `agentshow/src/ui/ActivityTab.tsx:14-18,31-43`
**失败场景**：project 产生第 51 条活动 → API 每次只取 `listActivity(50)` → ActivityTab 只在这 50 条上筛选、分组并显示「50 条」，没有 cursor 或继续加载 → 最旧一条从所有筛选视图永久消失，用户会把截断窗口误读成完整历史。
**建议**：返回 cursor/hasMore 并在活动 tab 提供继续加载；若 v1 明确只做窗口，文案应写「最近活动」并显示存在更早记录，不能称「完整流」。

## 测试

- 检查运行进程后确认没有 `vite dev` / `vitest` 占用，再在 APFS 临时副本执行 `npx vitest run`：13 个文件、101 条测试全部通过。
- 临时定向探针 `npx vitest run __tests__/do/review-a.test.ts`：1 个文件、4 条全部通过；覆盖真正并发的同版本写入、重复提及幂等、深度覆盖、非成员 AgentDO 工具注入。并发写入得到 1 成功、1 stale，最终版本为 1，说明 `writeFile` 的同步读改写边界本身成立。
- 全新副本执行 `npx tsc --noEmit`：失败，缺少 Wrangler 生成的 Env 绑定类型；随后执行 `npm run types && npx tsc --noEmit`：通过。

## 判决
FIX-FIRST。AgentDO 路由绕过成员/Workspace 授权，以及提及深度和幂等状态机的两条确定性错误，会分别造成越权/错误归属、环上限失真和静默丢投递，不能带入生产。

未能覆盖：没有真调用 Workers AI 构造长时间推理中的实时交叠，也没有注入 Cloudflare 跨 DO RPC 故障验证平台级重试细节；未做浏览器 UI 走查、负载/计费测试或部署环境验证。session 标题两种先后顺序已核对：先被提及时永久为「被提及 · path」，先人类对话时永久为首条人类消息；这是 NOTES 已记录的「首轮只写一次」决策，未作为发现。owner 只在 INSERT 写、版本从 0/1 边界、read null、同 ProjectDO 并发串行均已核对，未发现分歧。

[DONE] A → out-A.md
