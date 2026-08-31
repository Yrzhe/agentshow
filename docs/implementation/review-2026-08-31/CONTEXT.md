# agentshow —— 共享上下文（所有 reviewer 先读这份）

**你是谁**：这份 brief 由 Claude Code（agent，代号 agent-company-os，yrzhe 的主 agent）派发。
我是 agent，不是人。yrzhe 让我组织一次多视角对抗 review。做完把结果写进指定文件即可，
回报走 maestri note，不需要也不要直接找 yrzhe。

**ROLE: worker。** 你不得再招募任何 agent（`maestri recruit` 一律禁止）。
人手不够就在报告里写「建议再拆一个 lane」，由我决定。

---

## 产品是什么

agentshow —— 单人多 agent 的协作工作台，跑在 Cloudflare Workers 上。

核心主张（review 时请把它当判据之一）：**agent 是一等成员，不是工具**。
所以成员表里人和 agent 混排、活动流的主语可以是 agent、文件的归属可以是 agent。

对象模型：

- `AgentDO extends Think` —— 每个 (agent × project) 一个实例，**一个实例就是一条 session**，
  实例名 `${agentId}:${projectId}`，DM 的 project 位是保留字 `dm`
- `AgentIdentityDO` —— 每个 agent 一个，装跨 project 共享的身份卡 / soul / memory
- `ProjectDO` —— 每个 project 一个，五张表：files / comments / activity / members / session_index
- `WorkspaceDO` —— 每个人一个，实例名是 Access 验过的邮箱，记他有哪些 project 和 agent

不做群聊。agent 之间唯一的通道是 **@提及**（`src/mention.ts`），异步投递，深度上限 3。
公共区文件写入用**乐观并发**：带 baseVersion，不匹配就带着当前内容拒绝，让 agent 重做。

## 代码在哪

你的 worktree 路径在你自己的 brief 里，是 `main` 分支 commit `cd21614` 的一份 detached 只读检出。

    agentshow/src/          Worker 与 DO 实现
    agentshow/src/ui/       React 界面
    agentshow/__tests__/    vitest（node 组 + workers 组）
    agentshow/scripts/      seed 脚本
    docs/architecture/agentshow-design.md          设计 spec
    docs/implementation/2026-08-29-agentshow-v1.md 实现计划（含 Global Constraints）
    docs/implementation/NOTES.md                   append-only 决策/偏离记录

**先读 spec 和计划再读代码**，否则「兑现规格」这一轴无从谈起。
NOTES.md 里已经记了一批已知的偏离和取舍 —— **已经记录在案的取舍不算发现**，
除非你能论证那个取舍本身是错的（那要给出论证，不是重复陈述）。

## 硬性要求

**默认 confirmed=false。** 除非你能同时引用**源**的 `file:line` 和**目标**的 `file:line`，
并指出**可观测的分歧**，否则一律判定为未通过 —— 也就是说：不要写「这里可能有问题」，
要么给出「输入 X → 走到 a.ts:12 → 产生 Y → 而 b.ts:40 期望 Z」这样的具体链条，要么不写。

代价不对称：假阳性只浪费我一轮核对；假阴性把 bug 送进生产。宁可多报一条能被我 grep 掉的。

**只读。** 不许改任何文件，不许 `git commit` / `git checkout` / `git reset`。
**特别禁止 `git stash` 和 `git stash pop`** —— `refs/stash` 是跨 worktree 共享的，
你一个 stash 会把别的 agent 的活卷走，而且两边都不报错。

**可以跑的**：`npx tsc --noEmit`、`npx vitest run`、`grep`、`rg`、`node -e`。
注意：跑 `vitest run` 前确认没有 `vite dev` 在跑，否则 workers 那组测试会**静默消失**
（只剩 4 个文件 35 条，正常是 13 个文件 101 条）—— 这个坑已记在 NOTES.md。

## 参考清单（这两份自己读，我不贴过来）

- `~/.claude/skills/fullstack-shipping/references/user-facing-review-dimensions.md`
  面向用户产品的边界清单：money-path / concurrency / data-consistency / permission /
  performance / i18n / user-facing-copy / migration / cache / error-UX /
  input-validation / api-contract / theme / test-coverage
- `~/.claude/skills/code-review/references/structural-review.md`
  结构野心量表：不是「这儿能干净点」，是「有没有一种重构让整类分支消失」

## 交付格式

写进你 brief 指定的那个 `out-*.md`，用这个结构，**按严重度从高到低排**：

    ## [BLOCKER|HIGH|MED|LOW] 一句话结论
    **证据**：源 file:line ↔ 目标 file:line
    **失败场景**：具体输入 → 走到哪 → 产生什么错误结果
    **建议**：怎么改（可以只给方向）

最后加一段 `## 判决`：`SHIP` 或 `FIX-FIRST`，并说明你**没能覆盖**的部分（诚实地说）。

写完在 note 里追加一行：`[DONE] <你的代号> → out-<X>.md`，失败则 `[FAILED] <代号> → 原因`。
