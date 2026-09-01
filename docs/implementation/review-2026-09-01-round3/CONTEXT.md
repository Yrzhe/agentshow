# 审的是「对修复的修复」

这份 brief 由 Claude Code（agent，代号 agent-company-os，yrzhe 的主 agent）派发。
我是 agent，不是人。做完写进指定文件即可，不需要找 yrzhe。

**ROLE: worker。** 不得再招募 agent。

**任务性质：核对不变量。** 这是对我们自己代码的正确性复核 —— 检查一批改动
有没有做到它声称做到的事、有没有顺手破坏别的东西。不是渗透测试。

---

## 三轮的来龙去脉

agentshow 是跑在 Cloudflare Workers 上的单人多 agent 协作工作台。

- **第一轮**：四个 reviewer 审 v1，报了 32 条，其中四条 P0。
- **第二轮**：我修了那四条（commit `ceae45e`）。两个 reviewer 审那批修复，
  抓到**两条是我修的时候自己新造的**。
- **第三轮（你在这里）**：我修了那两条（commit `085cbe4`）。**你审这一批。**

第二轮抓到的两条，正是这次要防的那类：

1. 我把提及深度改成写进消息正文。但拼装时先放**发起方 agent 完全可控**的
   message、最后才追加真实深度，而解析取第一个匹配 —— agent 复述一遍收到的
   通知就把旧的低深度带过去了，环的防护等于换个形式重新打开。
2. 我把幂等键从「内容拼」改成「每次随机」。结果生产里没有任何调用方能命中
   去重，断线重试会把目标真的叫醒两次 —— 修成了原毛病的反面。

**这一轮请假设我又干了同类的事。**

## 这一批改了什么（**当成待验证的声称**）

`git show 085cbe4 --stat` 看全貌。摘要：

- `src/mention.ts`：新增 `stripDepthMarks()`，把正文里的深度标记替换成
  「（深度标记已移除）」；`depthInText()` 改成取**所有**匹配里的**最大值**。
- `src/server.ts`：`notifyMention` 拼装前先 `stripDepthMarks(p.message)`。
- `src/api.ts`：`SendMention` schema 接受可选 `mentionId` 并透传；
  `duplicate` 从 400 改成 201（幂等成功）。
- `src/ui/FileDetail.tsx`：Composer 用一个 ref 存 `actionId`，
  提交前生成、成功后清空，失败重试复用。
- `src/agent-key.ts`：新增 `DM_SLOT` / `isProjectId`；建 project 时挡掉 `dm`。
- 新增 `__tests__/agent-route.test.ts`，扩充 `__tests__/agent-key.test.ts`
  和 `__tests__/do/mention.test.ts`。

## 你的工作目录

worktree 在你的 brief 里，是 `fix/p0-batch` 的只读检出。

    git log --oneline -5
    git show 085cbe4              这一批的完整 diff
    git diff ceae45e..HEAD        同上
    git diff 6b480e0..HEAD        从原始代码到现在的全部

历史报告在 `docs/implementation/review-2026-08-31/`（第一轮四份）和
`docs/implementation/review-2026-09-01-fixes/`（第二轮两份）。
问题清单 `docs/implementation/issues_agentshow.json`。
决策与偏离 `docs/implementation/NOTES.md`。
**这些是历史快照，判当前状态一律以现码为准。**

## 硬性要求

**默认 confirmed=false。** 没有源和目标两处 `file:line` 加一条可观测的分歧，
不要写进报告。宁可多报一条能被我 grep 掉的。

**只读。** 不改文件，不 `git commit`/`checkout`/`reset`。
**禁止 `git stash`** —— refs/stash 跨 worktree 共享，会卷走别人的活。

可跑 `npx tsc --noEmit`、`npx vitest run`、`grep`、`node -e`、`npx vite dev`。
两个坑：
- 全新检出直接跑 `tsc --noEmit` 是红的，先 `npm run types`（已知问题 A-8）。
- 跑 vitest 前确认没有 `vite dev` 在跑，否则 workers 那组**静默消失**
  （只剩 4 文件，正常是 **15 文件 128 条**）。**核对文件数，别只看颜色。**

## 交付格式

写进 brief 指定的 `out-*.md`，按严重度从高到低：

    ## [BLOCKER|HIGH|MED|LOW] 一句话结论
    **证据**：源 file:line ↔ 目标 file:line
    **失败场景**：具体输入 → 走到哪 → 产生什么错误结果
    **建议**：怎么改

最后 `## 判决`：`SHIP` 或 `FIX-FIRST`，并诚实列出**没能覆盖**的部分。
写完 touch 你 brief 指定的 DONE 文件。
