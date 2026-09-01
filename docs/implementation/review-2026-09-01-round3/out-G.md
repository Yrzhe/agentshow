## [HIGH] 失败后的编辑仍沿用旧动作 ID：改文案会被吞，换目标会让两名 agent 都开工
**证据**：源 `agentshow/src/ui/FileDetail.tsx:268-301`、`agentshow/src/ui/FileDetail.tsx:312-324`（`actionId` 只在首次提及时生成、只在成功后清空；正文和目标变化不重置，也没有冻结第一次动作的 payload）↔ 目标 `agentshow/src/server.ts:139-146`、`agentshow/src/api.ts:341-344`（目标 AgentDO 只按 `mentionId` 去重，duplicate 又作为 201 成功返回）。真服务上先向 Ferrule 发送 `mentionId=r3-g-fixed-0001`、正文「第一版正文」得到 `201 {ok:true}`；沿用同一 ID 改成「修改后的第二版正文」得到 `201 {ok:false,reason:"duplicate"}`。Ferrule 的 `cf_think_submissions` 实际只有 1 条且状态 `completed`，消息里只有第一版正文，第二版没有进入；项目 activity 也只有 1 条 Ferrule mention。再沿用该 ID 改投 Verdigris 得到 `201 {ok:true}`，切回 Ferrule则再次 duplicate；两个目标各有 1 条 completed submission。
**失败场景**：服务端已经接纳给 Ferrule 的提及，但响应在路上断掉 → Composer 显示失败并保留 `actionId` → 用户修改文案再点，服务端把它当旧动作重试并回 201，界面清空，但修改后的要求从未送达。若用户改选 Verdigris，同一个 ID 在另一个 AgentDO 的 ledger 中尚未出现，于是 Verdigris也被叫醒；此前已接纳的 Ferrule并不会撤回，两名 agent 会同时按不同要求行动。
**建议**：把一次动作建模为不可变的 `{mentionId,toAgentName,path,message}` 快照；失败重试只允许原样重发。用户修改正文、文件或目标时明确创建新动作和新 ID，并提示上一动作的接纳状态仍不确定；不要让 duplicate 的 201 抹掉与原动作 payload 不同的当前草稿。

## [MED] 新建闸没有处置既有 `dm` project，历史项目仍会打开成无公共区工具的 DM session
**证据**：源 `agentshow/src/workspace.ts:48-74`、`agentshow/src/api.ts:249-259`（Workspace 可已有任意 `project_id` 行，读取既有项目时不再调用 `isProjectId`）↔ 目标 `agentshow/src/agent-key.ts:63-68`、`agentshow/src/agent-key.ts:98-104`、`agentshow/src/server.ts:164-166`（显式 project `dm` 与无 project 生成同一 key，解析为 `null`，`beforeTurn` 直接返回）。隔离 worker 探针在当前代码中模拟升级前数据：向 WorkspaceDO 写入 `{projectId:"dm",name:"Legacy DM Project"}` 后，`GET /api/projects/dm` 实际返回 200 和该项目；`parseAgentKey(agentKey(owner,"ferrule","dm"))` 实际得到 `projectId:null`。探针 1/1 通过。
**失败场景**：部署前已经创建过名为 `dm` 的项目 → 部署后它仍列在 Workspace 并能打开、文件 API 仍指向 `scoped(owner,"dm")` → 用户与该项目里的 agent 对话时 session key 却被解释成 DM → `beforeTurn` 不注入 `readProjectFile`、`writeProjectFile`、`mentionAgent` 等项目工具，历史项目静默失去 agent 工作能力。
**建议**：在发布边界显式处理既有保留字数据：若允许破坏式清理，删除 Workspace 中的 `dm` 引用并给用户明确错误；若数据必须保留，先把 Workspace/ProjectDO/相关 session 统一重命名到合法 slug。读取项目和构造 session 时也应拒绝保留字，避免继续展示一个注定不可工作的项目。

## 判决
FIX-FIRST

已覆盖：提交 `085cbe4` 相对 `ceae45e` 的相关数据流；锁定依赖下 `npm run types` 与 `npm run typecheck` 通过；正常 Vitest 15 个文件、128 条测试全部通过（测试池另残留一个不存在的 `zz-hops.test.ts` 缓存项，形成第 16 个失败套件，但没有减少正常 15/128）；真服务验证 `POST projectId=dm` 返回 400 且错误明确；同 ID 重投的目标 ledger 为 1；夹带深度标记在目标实际消息中被替换为「深度标记已移除」，只保留系统追加的真实第 0 跳；边界实现按 0→1→2→3 放行、4 在 `deliverMention` 前拒绝，与「第 4 跳必须拦」一致。基本链路真跑结果为：Ferrule 创建 `review.md` v1 → Ferrule @ Verdigris → Verdigris 留 1 条评论，活动顺序 `created → mentioned → commented`。

未能覆盖：没有故意制造浏览器层真实丢包，只用当前 Composer 状态机对应的同 ID HTTP 序列复现；没有让远程模型实际跑完整 A↔B 四跳环，深度 3/4 的行为来自 worker 测试与现码时序；未验证生产 Cloudflare Access、线上持久化数据中是否实际存在历史 `dm` 项目。真实 Workers AI 基本链路已跑通。
