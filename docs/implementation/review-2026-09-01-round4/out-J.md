## HIGH 提及深度仍未绑定到当前 turn，15 分钟内的独立对话会继承旧链，排队过久的真链反而会归零
**证据**：源 `agentshow/src/server.ts:145-183`（每个 project turn 都注入同一个 mention 回调，回调里没有当前 submission/turn 的链标识或深度）↔ 目标 `agentshow/src/mention.ts:74-76`、`agentshow/src/project.ts:182-190`（只按 `fromId` 查询 15 分钟内所有记录的 `MAX(depth)` 来决定下一跳）
**失败场景**：一条链刚把 Ferrule 叫醒到 depth=3；15 分钟内，用户另开一次普通聊天直接让 Ferrule @ Verdigris。普通聊天不是旧链的一跳，但回调仍查到 Ferrule 的旧 depth=3，算出 4 并返回 `max_depth`，合法的新任务被拒。反方向同样成立：若 depth=3 的提及在队列或推理中停留超过 15 分钟才调用工具，查询返回 null，下一跳被重算成 0，第 4 跳会被放行。时间窗口不能替代链/turn 身份。
**建议**：把不可伪造的链标识和 depth 绑定到被接收的 submission/turn，并让 `beforeTurn` 注入的 mention 回调闭包携带这份服务端状态；普通用户 turn 明确从 0 开始。不要再从 agent 的窗口历史反推当前 turn 属于哪条链。

## MED 文件详情一旦卸载就丢失幂等动作，响应丢失后关闭再打开会再次叫醒目标
**证据**：源 `agentshow/src/ui/ProjectPanel.tsx:107-115`（关闭详情会卸载 `FileDetail`，文件路径还被用作 React key）↔ 目标 `agentshow/src/ui/FileDetail.tsx:271-309`（mention id 只存在组件内 `useRef`，网络失败时保留，但卸载后没有任何持久化位置）
**失败场景**：服务端已接受提及，但响应在返回途中断线；界面显示「没能叫醒」。用户关闭文件详情、重新打开并重输同一提及，旧 ref 已消失，新建 UUID，服务端把它当新动作接受，于是同一个 agent 被叫醒两次、重复推理和计费。当前快照键只解决同一次挂载内「改目标/改正文」的问题。
**建议**：把 pending mention action 提升到不会随详情卸载的父级状态，或持久化为按 `{projectId,targetId,path,text}` 索引的 session 级 pending map；只有拿到确定成功响应或用户明确放弃该动作时才清除。

## MED 历史 `dm` 项目被静默从列表和详情入口抹掉，没有迁移或可恢复提示
**证据**：源 `agentshow/src/workspace.ts:66-86`（`listProjects` 过滤非法行，`getProject("dm")` 直接返回 null）↔ 目标 `agentshow/src/api.ts:189-201`、`agentshow/src/api.ts:249-255`（左栏完全依赖过滤后的列表，直接访问则统一返回 404）
**失败场景**：升级前数据库里存在 `projects.project_id='dm'` 的行及其 ProjectDO 文件；升级后 `/api/me` 不再列它，直接访问 `/api/projects/dm` 又得到 404。数据仍在存储中，但用户看到的是项目消失，无法判断是保留字冲突，也没有改名、导出或恢复入口。
**建议**：升级时显式迁移/改名历史 `dm` 行，或至少把非法记录作为带错误状态的条目返回并提供恢复路径；存储边界继续拒绝新写入可以保留。HTTP 新建路径已由 `agentshow/src/api.ts:33-36` 的 zod refine 提前挡住，所以 `addProject` 的抛错是可取的纵深防御，不是正常 HTTP 错误路径。

## LOW 新深度测试没有端到端跑出第 4 跳，且删掉了“正好等于上限仍放行”的边界守卫
**证据**：源 `agentshow/__tests__/do/mention.test.ts:88-100`（测试直接调用 `recordMentionHop` 写入 depth=3 后只投递一次）↔ 目标 `agentshow/src/mention.ts:74-76`、`agentshow/src/mention.ts:104-106`（真实正确性同时依赖上一跳被正确记录、下一跳读取并递增，且判断必须是 `>` 而不是 `>=`）
**失败场景**：若以后 `deliverMention` 错把每次成功 hop 都记录为 0，现有「人→Verdigris→Ferrule」测试仍能得到 0、1，手工塞 depth=3 的 max 测试也仍会通过，但真实 A↔B 链永远到不了 4；若判断改成 `>=`，depth=3 会被误拒，当前测试也抓不到。测试标题声称防住 A↔B 循环，实际约束的是手工构造后的读取分支。
**建议**：用真实 `deliverMention` 连续完成 depth 0、1、2、3，再断言第 4 次拒绝；完整断言每一次成功结果和 ledger/活动副作用。保留一条独立的 depth===3 放行边界测试。

## LOW 三处成功响应断言改成部分匹配，完整返回契约不再受测试保护
**证据**：源 `agentshow/src/mention.ts:49-54`（成功、max_depth、unknown_agent、duplicate 是互斥返回形状）↔ 目标 `agentshow/__tests__/do/mention.test.ts:36-40`、`agentshow/__tests__/do/mention.test.ts:118-136`、`agentshow/__tests__/do/api.test.ts:182-197`（实际有三处成功响应从完整相等放松为 `toMatchObject`，不是两处）
**失败场景**：成功响应意外同时带上 `reason`、错误的额外状态字段或其他泄漏字段时，这三条测试仍为绿；API 用例也没有显式确认新增的 `depth: 0`。这会让调用方看到与判别联合类型不一致的 JSON，而测试不报。
**建议**：改回完整形状断言：普通成功明确 `toEqual({ok:true,toAgentId:"…",depth:0})`，链中成功分别断言完整 depth；duplicate 继续保持完整相等。

## LOW 架构文档仍描述已删除的 session 深度和旧投递顺序
**证据**：源 `docs/architecture/agentshow-design.md:169-175`、`docs/architecture/agentshow-design.md:225-235`（仍写 ProjectDO 先记 activity、AgentDO 派生 session，以及「每条 session 记提及深度」）↔ 目标 `agentshow/src/mention.ts:90-109`、`agentshow/src/project.ts:174-200`（实际由 `deliverMention` 先通知目标，接受后才在 ProjectDO 的 `mention_chain` 和 activity 记账）
**失败场景**：维护者按设计文档排查重复投递或深度问题，会去 AgentDO/session 找已经不存在的控制状态，并误以为未接受的投递也先写了 activity；文档无法作为当前机制的事实来源。
**建议**：把 4.2 的流程图和第 6 节改成当前 `deliverMention → notifyMention accepted → recordMentionHop + recordMention` 顺序，并明确 ledger 的键、窗口与局限。`CHANGELOG.md:41` 只承诺「深度上限 3 跳」，这一句本身仍准确。

## 判决
FIX-FIRST

必须先修提及深度与当前 turn 无绑定的问题；它同时造成合法独立任务被误拦和真实长链漏拦，正好破坏这次重写要守的核心不变量。

已验证：

- `npm run types` 后 `npx tsc --noEmit` 通过。
- `npx vitest run` 为 15/15 个测试文件、125/125 条测试通过；结束阶段另打印 `Network connection lost` / close timeout，但进程 exit 0，测试汇总完整。
- 全仓运行时代码、测试、脚本中已无 `depthOf` / `depthLine` / `depthInText` / `stripDepthMarks` 引用；命中只存在于追加式 `NOTES`/生成的历史看板和历史 review 快照，不是悬空运行时引用。
- `notifyMention` 的 `depth` 仍有用途：`agentshow/src/server.ts:97-128` 将它写入 submission metadata；正文不再暴露深度。模型无需知道深度即可由服务端强制截断，但 `mentionAgent` 的 description 只解释 `unknown_agent`，没有解释可能返回的 `max_depth`，建议随主修一起补齐提示。
- 删除的三条正文编解码测试对应的功能已整体删除，不需要一比一保留；缺口是新 ledger 的真实链与边界没有被端到端覆盖。

未覆盖：没有启动 dev、没有调用真实 Workers AI、没有做浏览器交互；前端 remount 场景为源码状态流复核，没有真浏览器网络断线录制。
