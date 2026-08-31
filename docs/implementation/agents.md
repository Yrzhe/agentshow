# 招募过的 agent

> 每次通过 Maestri 招募的 agent 都记在这里，下次同类活先读这张表再决定复用还是新招。

| 名字 | 工具 | 角色 / 范围 | brief | 建立 | 最后使用 | 状态 | 怎么恢复 |
|---|---|---|---|---|---|---|---|
| Latch | Codex (gpt-5.6) | v1 多视角审查 Lane A —— 并发、状态机、失败路径 | `/tmp/agentshow-review/brief-A.md` | 2026-08-31 | 2026-08-31 | done | 已 dismiss；报告见 `docs/implementation/review-2026-08-31/out-A.md` |
| Kestrel | Codex (gpt-5.6) | Lane B —— 鉴权、多租户边界、输入与注入 | `brief-B.md` | 2026-08-31 | 2026-08-31 | done | 同上，`out-B.md` |
| Vellum | Claude Code (Opus 5) | Lane C —— 前端、用户可见面、错误 UX | `brief-C.md` | 2026-08-31 | 2026-08-31 | done | 同上，`out-C.md` |
| Cadence | Codex (gpt-5.6) | Lane D —— 规格兑现、契约对齐、prompt↔数据流 | `brief-D.md` | 2026-08-31 | 2026-08-31 | done | 同上，`out-D.md` |

| Plumb | Codex (gpt-5.6) | 修复复审 Lane E —— 命名空间与路由闸的正确性（静态） | `review-2026-09-01-fixes/brief-E.md` | 2026-09-01 | 2026-09-01 | done | 已 dismiss；报告 `out-E.md` |
| Tallow | Codex (gpt-5.6) | 修复复审 Lane F —— 深度/幂等/前端修复的半修与新引入 | `brief-F.md` | 2026-09-01 | 2026-09-01 | done | 已 dismiss；报告 `out-F.md` |

四条 lane 各自在 `main` 的 detached worktree 上只读审查同一个 commit `cd21614`，
互不写同一批字节。产出的发现已逐条核过证据，进 `issues_agentshow.json`（A-1 起）。

**下次同类活**：这四个攻击面的划分是有效的（A 与 B 独立撞上同一条 BLOCKER，
说明覆盖有重叠冗余但不浪费）。重跑时直接复用这四份 brief，把 CONTEXT.md 里
的「已记录在案的取舍不算发现」那段留着 —— 它挡掉了大量重复报告。

## 复审那一轮的教训（2026-09-01）

- **修复必须再审一轮。** Tallow 抓到的两条都是**我修 P0 时自己引入的**：
  深度标记能被正文夹带覆盖（等于把环的防护换个形式重新打开），
  以及幂等键改成随机后生产调用方永远命中不到去重。
  "agent 善发现、不善修复" 在这一轮得到了直接印证。
- **Codex 会因安全措辞拒绝任务。** Plumb 的 brief 里写了「绕过」「攻击」，
  它触发了 cybersecurity 拒绝并停下（沙箱里还没有 curl）。
  换成「只做静态审查，回答三个纯代码问题」之后一次通过，
  而且给出了带 RFC 条款和 partyserver 真源码行号的答案。
  **审自己代码的安全性时，把任务描述成「核对不变量」而不是「攻击」。**
- 需要发真请求验证的那半边，我自己做了（`__tests__/agent-route.test.ts`）。
