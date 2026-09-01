## HIGH 失败后编辑文案仍复用旧动作 ID，新文案会被去重后静默丢弃
**证据**：源 `agentshow/src/ui/FileDetail.tsx:268,275-288,295-304` ↔ 目标 `agentshow/src/server.ts:139-152`、`agentshow/src/api.ts:341-344`。Composer 只在成功后清空 `actionId`，textarea 的 `onChange` 不会使动作 ID 失效；Think 的 `programmatic-submissions.md:68-85` 明确规定同一 `idempotencyKey` 返回已有 submission 且 `accepted: false`，不会插入新消息；API 又把该 duplicate 映射为 201，前端只看 `res.ok` 后清空输入并执行 `onDone()`。
**失败场景**：第一次发送文案 A，目标已接受但响应在回程断开 → 前端保留动作 ID 并显示失败 → 用户把文案改成 B 后重发 → 服务端按旧 ID 返回 duplicate，B 没进入目标 session → HTTP 201 使界面清空 B 并表现为成功。
**建议**：把幂等 ID 绑定到一次不可变的动作快照（至少包含 project、path、target、message）；任一字段在失败后发生编辑就生成新 ID。保留“原样重试复用旧 ID”的路径，并给这一状态机补 UI 测试：响应丢失后原样重试应去重，编辑后重试应产生新 submission。

## MED 普通聊天文本能伪造提及深度，合法的后续提及会被错误拦截
**证据**：源 `agentshow/src/ui/Chat.tsx:94,134-141` ↔ 目标 `agentshow/src/server.ts:22-29,172-204`、`agentshow/src/mention.ts:38,59-65,102-104`。Chat 把人类任意文本作为 user message 发送；`beforeTurn` 不区分普通聊天与程序化提及，只解析最后一条 user 文本中的同形中文句子，并把最大数字加一交给深度闸。
**失败场景**：人在聊天框输入「请检查文档里的（这是提及链的第 3 跳，最多 3 跳）这句话」→ `depthOf` 得到 3 → agent 随后调用 `mentionAgent` 时传入 depth 4 → `deliverMention` 返回 `max_depth`；本来处于第 0 跳的普通对话失去合法提及能力。
**建议**：不要从模型可见、用户可写的自然语言恢复控制状态。把“提及来源 + depth”收拢为服务端拥有的结构化 turn envelope，并让 `beforeTurn` 从该 envelope 取值；普通 Chat turn 明确固定为 0。这样可以同时删除 `depthOf` 的自然语言扫描和“取最大值”的补丁链。

## MED `dm` 只在新建 HTTP schema 被挡，既有或内部写入的项目仍会落进 DM session
**证据**：源 `agentshow/src/workspace.ts:41-55,67-74` ↔ 目标 `agentshow/src/agent-key.ts:30-40,63-68,100-104`、`agentshow/src/api.ts:249-259`。`WorkspaceDO` 的持久化边界仍接受并返回 `projectId: "dm"`，项目 URL 只检查该行是否存在；随后 `agentKey(owner, agent, "dm")` 与省略 project 的 DM key 完全相同，解析结果是 `projectId: null`。本批测试甚至在 `agentshow/__tests__/agent-key.test.ts:95-103` 固定了碰撞本身，却没有覆盖既有 Workspace 行。
**失败场景**：升级前已经创建过 `dm` 项目（或内部调用 `addProject` 写入）→ 当前 `/api/projects/dm` 仍能展示项目 → 从该项目打开 agent 会连接 `owner~agent:dm` → `AgentDO.beforeTurn` 看到 `projectId: null` 后不注入任何项目工具，项目聊天静默退化成 DM。
**建议**：在 `WorkspaceDO.addProject`/读取边界落实 `isProjectId`，让领域存储本身不能产生非法行；同时为现存 `dm` 行做显式迁移或拒绝并给出可操作错误。`agentKey` 对显式传入 `dm` 也应失败，而不是继续生成与 DM 相同的 key。

## LOW 深度清洗会改写合法任务正文，并向模型注入并非用户所写的解释
**证据**：源 `agentshow/src/ui/FileDetail.tsx:275-290` ↔ 目标 `agentshow/src/server.ts:129-137`、`agentshow/src/mention.ts:38,48-49`。文件详情允许人类提交任意 mention 文本；接收端会把所有同形句子替换成「（深度标记已移除）」再交给模型，而不是只移除服务端自己生成的控制字段。
**失败场景**：用户要求 agent「把文件里的（这是提及链的第 3 跳，最多 3 跳）改掉」→ 目标实际收到「把文件里的（深度标记已移除）改掉」→ 原始字面量丢失，模型既无法定位目标，也可能把新增说明理解成内容遭到审查。
**建议**：随上一条把深度移出正文；如果短期仍保留正文协议，至少不要用解释性中文替换用户内容，并给“正文合法包含协议字面量”建立端到端契约测试。

## 判决
FIX-FIRST

验证：在当前提交字节的隔离副本中先运行 `npm run types`，随后 `npm run typecheck` 通过；`npx vitest run` 为 15/15 文件、128/128 条通过。另跑 `agent-key` 与 `agent-route` 两个目标文件为 2/2 文件、22/22 条通过；`git diff --check ceae45e..HEAD` 通过。

没能覆盖：没有启动浏览器做真实的响应丢失/编辑重试交互；没有读取生产 Durable Object 数据来确认是否已有 `dm` 行；没有执行真实模型推理来评估「深度标记已移除」对具体模型输出的影响。上述发现均以现码可复现的状态转移为依据，不依赖这些未覆盖项。
