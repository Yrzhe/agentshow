# 审第三批修复（提及深度的第三次重写）

这份 brief 由 Claude Code（agent，代号 agent-company-os，yrzhe 的主 agent）派发。
我是 agent，不是人。做完写进指定文件；不需要找 yrzhe。

**ROLE: worker。** 不得再招募 agent。

**任务性质：核对不变量。** 对我们自己代码的正确性复核 —— 一批改动有没有做到
它声称的事、有没有顺手破坏别的东西。不是渗透测试。

---

## 四轮的来龙去脉

agentshow 是跑在 Cloudflare Workers 上的单人多 agent 协作工作台。
agent 之间不做群聊，唯一通道是 @提及，要防 A @ B、B @ A 的死循环烧钱。

- **一轮**：四个 reviewer 审 v1，32 条，4 条 P0。
- **二轮**：我修了 P0。两个 reviewer 审那批修复，抓到 **2 条是我修的时候新造的**。
- **三轮**：我又修。两个 reviewer 再审，抓到 2 条，并指出一个**设计层**结论。
- **四轮（你在这里）**：我按那个结论重写了机制（commit `1cd648c`）。**你审这一批。**

**提及深度这个东西我已经写到第三版了**，前两版都被复审打回：

| 版本 | 深度存在哪 | 怎么坏的 |
|---|---|---|
| v1 | AgentDO 的一个单值键 | 排队的两条提及互相覆盖，环的防护双向失效 |
| v2 | 消息正文里一行中文 | agent 复述通知能夹带旧深度；人在聊天框打那句话能伪造 |
| v3 | ProjectDO 的 `mention_chain` 表 | ？ |

前两版错在同一件事：**控制状态放在了链条上其他参与者能写的地方**。
而它每次都伪装成一个具体 bug（并发覆盖 / 正则取第一个匹配）。

**请假设 v3 也有它自己的那个形状。**

## v3 是什么（**当成待验证的声称**）

`git show 1cd648c` 看完整 diff。

- `src/project-schema.ts`：新增 `mention_chain (to_agent_id, depth, at)` 表。
- `src/project.ts`：`recordMentionHop({toAgentId, depth, at?})` 插一行；
  `lastMentionDepth(agentId, windowMs)` 返回窗口内 `MAX(depth)`，没有则 null。
- `src/mention.ts`：`deliverMention` 自己算深度 ——
  `prior = lastMentionDepth(fromId, 15 分钟)`，`depth = prior === null ? 0 : prior + 1`，
  `depth > MAX_MENTION_DEPTH(3)` 就拒。投递成功后记一跳 + 记一条活动。
  **重投（duplicate）时两样都不记。**
- `src/server.ts`：删掉 `depthOf`；`notifyMention` 不再往正文追加任何标记；
  `beforeTurn` 不再算深度。
- `src/ui/FileDetail.tsx`：提及动作的 id 绑在 `{目标, 文件, 正文}` 的快照上。
- `src/workspace.ts`：`dm` 保留字改在存储边界挡 —— `addProject` **抛异常**、
  `listProjects` 过滤掉、`getProject` 返回 null。
- 测试重写。

## 你的工作目录

worktree 在你的 brief 里，是 `fix/p0-batch` 的只读检出。

    git log --oneline -6
    git show 1cd648c              这一批
    git diff 085cbe4..HEAD        同上
    git diff 6b480e0..HEAD        从原始代码到现在

历史报告：`docs/implementation/review-2026-08-31/`（一轮四份）、
`review-2026-09-01-fixes/`（二轮两份）、`review-2026-09-01-round3/`（三轮两份）。
问题清单 `docs/implementation/issues_agentshow.json`；决策记录 `NOTES.md`。
**这些是历史快照，判当前状态一律以现码为准。**

## 硬性要求

**默认 confirmed=false。** 没有源和目标两处 `file:line` 加一条可观测的分歧，
不要写进报告。宁可多报一条能被我 grep 掉的。

**只读。** 不改文件，不 commit / checkout / reset。**禁止 `git stash`**
（refs/stash 跨 worktree 共享，会卷走别人的活）。

可跑 `npx tsc --noEmit`、`npx vitest run`、`grep`、`node -e`、`npx vite dev`。
两个坑：
- 全新检出直接跑 `tsc --noEmit` 是红的，先 `npm run types`（已知问题 A-8）。
- 跑 vitest 前确认没有 `vite dev` 在跑，否则 workers 那组**静默消失**
  （只剩 4 文件，正常是 **15 文件 125 条**）。**核对文件数，别只看颜色。**

起 dev 会真调 Workers AI（几十秒一轮、要花钱），**请克制**：
能用 HTTP 端点或 worker 测试验的就别跑模型。

## 交付格式

写进 brief 指定的 `out-*.md`，按严重度从高到低：

    ## [BLOCKER|HIGH|MED|LOW] 一句话结论
    **证据**：源 file:line ↔ 目标 file:line
    **失败场景**：具体输入 → 走到哪 → 产生什么错误结果
    **建议**：怎么改

最后 `## 判决`：`SHIP` 或 `FIX-FIRST`，并诚实列出**没能覆盖**的部分。
写完 touch 你 brief 指定的 DONE 文件。
