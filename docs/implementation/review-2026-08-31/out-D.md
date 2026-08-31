## BLOCKER 提及深度存在 session 级单值里，排队消息会互相覆盖并绕过 3 跳上限
**证据**：源 `agentshow/src/mention.ts:60-66`（每次投递把各自的 `depth` 交给目标 AgentDO）↔ 目标 `agentshow/src/server.ts:102-124`、`agentshow/src/server.ts:129-140`、`agentshow/src/server.ts:180-181`（目标先把 depth 覆盖写进同一个 `MENTION_DEPTH_KEY`，队列消息的 metadata 虽保留 depth，工具执行却只读这个共享键，任一轮结束还会删除它）

**失败场景**：B 的 session 正在排队时，A 以 depth=1 @ B，紧接着 C 以 depth=3 @ B。第二次 `notifyMention` 把共享键改成 3；A 那一轮若先执行，再 @ 人会被算成第 4 跳而误拦。A 轮结束删除共享键后，真正 depth=3 的 C 轮执行时又读到 0，它下一跳被算成 1，原本必须拦住的第 4 跳被放行，A↔B 环可以继续烧模型额度。

**建议**：不要用 session 级可变键传递逐消息状态；从当前 submission/turn 的 metadata 取 depth，或把 depth 编入该条 user message 并在 `beforeTurn` 按当前消息解析。补两条排队提及交错的回归测试，覆盖误拦和越界放行两个方向。

## HIGH fresh checkout 的类型检查是红的，违反 Global Constraint
**证据**：源 `agentshow/src/env.d.ts:11-14`（仓库内的 `Env` 只声明 `POLICY_AUD` / `TEAM_DOMAIN`）↔ 目标 `agentshow/src/server.ts:59-60`、`agentshow/src/server.ts:156-157`、`agentshow/src/server.ts:207`（实际要求 `AgentIdentityDO`、`ProjectDO`、`ASSETS` 等 binding）

**失败场景**：在隔离的 fresh checkout、使用与 lockfile SHA 完全相同的依赖运行 `npm run typecheck`，`tsc --noEmit` 以 1 退出；错误包括 `Property 'AgentIdentityDO' does not exist on type 'Env'`、`ProjectDO`、`WorkspaceDO`、`ASSETS`，并级联到全部 DO 测试。实现计划 `docs/implementation/2026-08-29-agentshow-v1.md:15-24` 明确规定任何 commit 前 tsc 红不得提交。相同副本的 `npm test` 为 13 files / 101 tests 全绿，测试绿没有覆盖这个门禁失败。

**建议**：把可复现的 binding 类型纳入仓库或让 `typecheck` 在 `tsc` 前确定性生成类型；随后在 clean checkout 跑 `npm run typecheck && npm test`，不要依赖某台开发机残留的生成文件。

## HIGH 相同文案的第二次合法 @提及会被永久吞掉，却仍记录为已提及
**证据**：源 `agentshow/src/ui/FileDetail.tsx:261-277`（每次点击都发一个新的 mention 请求，没有外部事件 ID）↔ 目标 `agentshow/src/server.ts:118-125`、`agentshow/src/mention.ts:68-76`（幂等键只由 fromId+path+message 内容组成，`submitMessages` 的接纳结果被丢弃，随后无条件记录成功 activity）

**失败场景**：同一个人在 `pricing.md` 上第一次发「再检查一次」后，过一小时对同一 agent、同一路径再次发完全相同的话。第二次命中旧 idempotency key，Think 返回既有 submission 而不插入新消息；`notifyMention` 忽略 `accepted:false`，HTTP 仍返回成功并新增一条 mentioned activity。界面声称 agent 被叫醒两次，目标实际上只推理一次。

**建议**：由每个提及事件生成稳定且唯一的 mention ID，并只用该 ID 做重试幂等；让 `notifyMention` 返回 submission 接纳结果，`deliverMention` 仅在新接纳或明确的同事件重试语义下记录 activity。

## HIGH 「只读复审／只改文案」只是 prompt，实际工具允许它们改任意完整文件
**证据**：源 `agentshow/scripts/seed.ts:61-70`、`agentshow/scripts/seed.ts:84-103`（Verdigris 承诺「从不改代码」，Sable 承诺不改结构和逻辑）↔ 目标 `agentshow/src/server.ts:169-183`、`agentshow/src/agent-tools.ts:64-80`（所有 project agent 无差别拿到同一套工具，其中 `writeProjectFile` 可提交文件的完整新内容）

**失败场景**：Verdigris 被要求「顺手修掉你发现的问题」或模型偏离 soul 后，可直接调用 `writeProjectFile`；只要 baseVersion 当前，就会把整份文件写入。Sable 同样可以改组件结构。界面和身份卡仍把它们展示为独立只读 reviewer／文案专员，用户无法区分承诺是否已被破坏。

**建议**：把角色能力变成工具 allowlist 或 ProjectDO 权限：Verdigris 不注入写工具；Sable 若必须写同一文件，需要结构化 patch/受限变更边界或至少可审计的 policy gate。不要用绝对词承诺代码未强制的行为。

## MED unknown_agent 的恢复提示要求模型使用一个不存在的成员发现能力
**证据**：源 `agentshow/src/agent-tools.ts:110-123`（提示 unknown_agent 后「先用 listProjectFiles 之外的方式确认名字」）↔ 目标 `agentshow/src/agent-tools.ts:13-19`、`agentshow/src/agent-tools.ts:42-58`（公开工具只有五个，唯一 list 只列文件；没有列成员或查询 agent 身份的工具）

**失败场景**：模型把 Verdigris 拼成 Verdigriss，收到 unknown_agent 后按提示尝试恢复；它既不能列 project members，也不能按名字搜索 agent，只能猜另一个字符串或向用户报错。「先确认名字」这条 prompt 承诺不可达。

**建议**：增加只读 `listProjectMembers` / `findProjectAgent` 工具并返回可用于 mention 的规范名字，或把失败结果直接附上当前 agent 成员名单；在此之前删掉不存在的恢复路径。

## MED 文件讨论输入能生成 API 明确拒绝的正文
**证据**：源 `agentshow/src/ui/FileDetail.tsx:261-277`、`agentshow/src/ui/FileDetail.tsx:294-300`（textarea 无 `maxLength`，提交前只 trim）↔ 目标 `agentshow/src/api.ts:49-59`（comment text 与 mention message 均 `.max(4000)`）

**失败场景**：用户粘贴 4001 个字符，发送按钮保持可用并发出请求；API 返回 400，界面只显示「没能留下这条评论」或「没能叫醒」，用户不知道是长度超限，也没有可操作的剩余字数提示。

**建议**：前端与共享 schema 复用同一限制；textarea 设置 4000 上限和计数，提交前给出本地错误，并把服务端 zod issue 映射成具体错误信息。

## MED Activity 无法兑现推理失败和深度截断的错误处理承诺
**证据**：源 `docs/architecture/agentshow-design.md:223-231`（目标推理失败必须记「未能完成」，超过 3 跳必须在 activity 标出）↔ 目标 `agentshow/src/project-schema.ts:83-91`、`agentshow/src/mention.ts:42-44`、`agentshow/src/server.ts:134-141`（ActivityVerb 没有失败/截断状态；max_depth 直接返回；唯一完成 hook 只清深度）

**失败场景**：第 4 跳被拦时 Activity 没有任何记录；目标 submission 后续进入 error 时，提及方虽已不阻塞，但 project activity 也不会出现「未能完成」。用户看到的时间线停在「A 提及了 B」，无法判断 B 是仍在处理、失败还是被深度闸截断。

**建议**：为 blocked/failed 增加明确 activity 语义；max_depth 返回前记录截断，submission 终态进入 error/aborted 时由可恢复的完成回调写失败 activity，并用 submission/mention ID 保证幂等。

## 判决
FIX-FIRST。

已覆盖：spec/计划与 Global Constraints、浏览器→API 的输入限制、agent tools→ProjectDO、prompt/soul→工具可达性、stale 返回链、notifyMention 深度/幂等数据流、关键行为承诺与 Activity。验证结果：`npm test` 13 files / 101 tests 通过；`npm run typecheck` 失败。未覆盖：真实 Workers AI 推理的新增端到端演练、Cloudflare 线上 binding/Access 配置、浏览器视觉走查、SQLite 极限行大小的破坏性大载荷实验。
