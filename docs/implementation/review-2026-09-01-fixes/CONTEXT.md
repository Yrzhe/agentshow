# 审的是「一批安全修复」本身，不是原代码

这份 brief 由 Claude Code（agent，代号 agent-company-os，yrzhe 的主 agent）派发。
我是 agent，不是人。做完把结果写进指定文件；回报不需要找 yrzhe。

**ROLE: worker。** 不得再招募任何 agent。

---

## 背景

agentshow 是跑在 Cloudflare Workers 上的单人多 agent 协作工作台。
上一轮四个独立 reviewer 报了 32 条问题，其中四条 P0。**我把那四条修了，
你审的就是这批修复。**

修复前的四条 P0：

- **A-1** `routeAgentRequest` 之前零授权。Access 只验「能不能进站」，
  进来之后实例名是客户端给的，任意登录者能连别人的 session 并拿到那个
  project 的读写工具。实测 `GET /agents/agent-d-o/victim:proj/get-messages` → 200。
- **A-2** DO 实例名不带所有者。B 用 A 的 projectId 调一次 `POST /api/projects`，
  代码就把 B 加成 A 那个 ProjectDO 的成员，之后归属检查放行，B 读到 A 的文件。
  agent 同理能读到别人的 soul。
- **A-3** 提及深度存在一个 session 级的键里，投递时写、轮末删。两条提及排队到
  同一个 agent 时后到的覆盖先到的，先跑完的又删掉还没轮到的那条 ——
  环的防护双向失效（既误拦第 2 跳，也放行第 4 跳）。
- **A-17** 轮询失败会把整个应用永久换成一行英文异常，成功的轮询救不回来。

顺带修的：A-4（幂等键用内容拼，合法催办被吞）、A-12（会话索引失败阻断整轮推理）、
A-18（迟到响应把上个项目画到新项目上）。

## 修法摘要（**当成待验证的声称，不是事实**）

- DO 实例名改成 `${owner}~${agentId}:${projectId}`，owner 取自 Access 验过的邮箱。
  `ProjectDO` / `AgentIdentityDO` 是 `${owner}~${slug}`。见 `src/agent-key.ts`。
- 新增 `src/agent-route.ts` 的 `checkAgentRoute`：`routeAgentRequest` 之前
  校验实例名里的所有者等于验过的邮箱，形状不对一律 403。
- 提及深度写进消息正文（`depthLine` / `depthInText`，在 `src/mention.ts`），
  `beforeTurn` 从这一轮自己的消息里读。原来那个 DO 键整块删掉。
- 幂等键改成每次提及动作自己的 id；`notifyMention` 返回 `accepted` 给调用方。
- `src/client.tsx` 把 error 拆成 `fatal` / `stale`；`reload` 带上发起时的 projectId 比对。

**分隔符用 `~` 不用 `/`**：第一版用 `/`，测试全绿但浏览器里对话整个连不上 ——
agents SDK 把实例名原样拼进 URL 路径不编码。这一课记在 NOTES.md。

## 你的工作目录

你的 worktree 在 brief 里，是 `fix/p0-batch` 分支 commit `4c8e3f1` 的只读检出。

    git log --oneline -3          最近三个提交
    git show ceae45e --stat       这批修复动了哪些文件
    git diff 6b480e0..HEAD        修复前后的完整 diff

修复前的完整审查报告在 `docs/implementation/review-2026-08-31/`（四份 out-*.md），
问题清单在 `docs/implementation/issues_agentshow.json`，
设计决策与偏离记录在 `docs/implementation/NOTES.md`（append-only）。

## 硬性要求

**默认 confirmed=false。** 没有源和目标两处 `file:line` 加一条可观测的分歧，
就不要写进报告。宁可多报一条能被我 grep 掉的，也不要漏一条送进生产。

**这一轮的重点是「修复本身引入的新问题」。** 已知的经验：agent 善发现、不善修复，
修复常常引入**相邻类别**的新 bug；而且「类级修好 ≠ 实例全净」，
系统性修完总会逃掉一两个站点。请专门找这两类。

**只读。** 不改文件，不 `git commit` / `checkout` / `reset`。
**禁止 `git stash` / `stash pop`** —— refs/stash 跨 worktree 共享，会卷走别人的活。

可以跑 `npx tsc --noEmit`、`npx vitest run`、`grep`、`node -e`、起 `vite dev`。
注意：跑 vitest 前确认没有 `vite dev` 在跑，否则 workers 那组测试会**静默消失**
（只剩 4 文件 35 条，正常是 14 文件 116 条）。**跑完核对文件数，别只看颜色。**
另外全新检出直接跑 `npx tsc --noEmit` 是红的，要先 `npm run types`（这是已知问题 A-8）。

## 交付格式

写进 brief 指定的 `out-*.md`，按严重度从高到低：

    ## [BLOCKER|HIGH|MED|LOW] 一句话结论
    **证据**：源 file:line ↔ 目标 file:line
    **失败场景**：具体输入 → 走到哪 → 产生什么错误结果
    **建议**：怎么改

最后一段 `## 判决`：`SHIP` 或 `FIX-FIRST`，并诚实列出你**没能覆盖**的部分。
写完 `touch` 你 brief 里指定的那个 DONE 文件。
