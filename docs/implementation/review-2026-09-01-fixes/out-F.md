## [BLOCKER] 正文里的旧深度标记能覆盖系统追加的真实深度，A↔B 环仍可无限续命
**证据**：源 `agentshow/src/server.ts:124-130`（先拼接 agent 可控的 `p.message`，最后才追加真实 `depthLine(p.depth)`）↔ 目标 `agentshow/src/mention.ts:38-45`（`text.match` 只取整段正文里的第一个标记）；该结果随后在 `agentshow/src/server.ts:165-197` 被直接用于下一跳的 `depth + 1`。隔离 probe 组装「正文含第 0 跳标记 + 末尾真实第 3 跳标记」，实际 `depthInText(...) === 0`，不是 3。
**失败场景**：A 收到人类发起的第 0 跳后，在 `mentionAgent.message` 中复述自己看到的整段通知（工具允许任意正文，`agentshow/src/agent-tools.ts:120-125`），其中已经含有「第 0 跳」标记；A→B 的通知末尾虽追加真实第 1 跳，B 仍读到前面的 0。B 再原样转交给 A 时也读到 0。此后每轮算出的外发深度始终是 1，永远到不了 `agentshow/src/mention.ts:82-83` 的 `> 3` 拒绝条件，原 A↔B 烧钱环恢复为无界。模型复述标记或把它放进工具参数后，下一目标收到的是 `user` 消息，所以「只读最后一条 user」不能隔离它。
**建议**：不要从可控正文里搜索控制字段。优先把深度放进 submission metadata，并从当前 submission 的可信上下文读取；若 Think 暂时不给 `beforeTurn` 暴露 metadata，至少使用不可由 `p.message` 抢占的结构化尾部并只解析唯一的最后一行，发现多个标记时拒绝而不是取第一个。补一条经过 `notifyMention → submitMessages → beforeTurn` 的多跳集成测试，不能只测 `depthLine/depthInText` 往返。

## [HIGH] 生产入口没有稳定动作 ID，重试会真的叫醒第二次
**证据**：源 `agentshow/src/api.ts:56-60`、`agentshow/src/api.ts:320-332`（HTTP schema 和 `deliverMention` 调用都没有 `mentionId`）↔ 目标 `agentshow/src/mention.ts:102-113`（缺省时每次调用都生成新的 `crypto.randomUUID()`，所以 `accepted=false/duplicate` 无法命中）。前端在响应丢失时保留原文并允许再次提交，见 `agentshow/src/ui/FileDetail.tsx:261-284`。隔离 worker probe 对同一 owner/project/agent 连续发送两次完全相同的 HTTP payload：两次均返回 201，目标 `listSubmissions()` 实际为 2，且两个 `idempotencyKey` 不同。
**失败场景**：第一次 POST 已被目标 DO 接受，但响应在浏览器收到前断线；界面显示「没能叫醒」，用户按原内容重试。第二次请求在 API 层重新生成 UUID，Think 看成新 submission，于是同一 agent 再跑一轮，可能重复写文件、留评论、继续 @ 人并重复计费。agent 工具入口同样没有动作 ID（`agentshow/src/agent-tools.ts:120-125` ↔ `agentshow/src/server.ts:188-198`），因此模型或运行时重放工具动作也不能命中 `duplicate`。现有 `mention-fixed-id` 单测只证明手工传 ID 时 Think 能去重，没有覆盖任何生产调用方。
**建议**：在动作发起边界生成并持久复用 ID。HTTP 端由 Composer 为一次提交生成 `mentionId`，失败重试复用，API schema 接收并透传；agent 工具端使用稳定的 tool-call/action ID，或在服务端按当前 submission + tool-call 建键。只有明确的新催办才生成新 ID。`duplicate` 应作为幂等成功返回现有结果，而不是笼统 400。

## 判决
FIX-FIRST。

验证：在隔离 APFS 副本中先运行 `npm run types`，随后 `npm run typecheck` 通过；基线 `npm test` 为 **14 test files / 116 tests 全部通过**。额外只读复现 probe 为 2/2 通过，分别观察到「较早正文标记覆盖末尾真实标记」和「相同 HTTP payload 产生两条 submission」。`git diff --check 6b480e0..HEAD` 通过，审查 worktree `git status --short` 为空。

覆盖边界：已静态追踪 A-3、A-4、A-12、A-17/A-18 和三份被改测试；未调用远程模型实际跑 A↔B 环，避免产生不受控费用；未启动浏览器做 `stale` 浮层遮挡和 React concurrent render 的视觉/调度复现，因此这两项没有写成 confirmed finding。`FileDetail` / `AgentCard` 自身 fetch 失败（A-21）按 brief 视为范围外，未重新定级。
