# 招募过的 agent

> 每次通过 Maestri 招募的 agent 都记在这里，下次同类活先读这张表再决定复用还是新招。

| 名字 | 工具 | 角色 / 范围 | brief | 建立 | 最后使用 | 状态 | 怎么恢复 |
|---|---|---|---|---|---|---|---|
| Latch | Codex (gpt-5.6) | v1 多视角审查 Lane A —— 并发、状态机、失败路径 | `/tmp/agentshow-review/brief-A.md` | 2026-08-31 | 2026-08-31 | done | 已 dismiss；报告见 `docs/implementation/review-2026-08-31/out-A.md` |
| Kestrel | Codex (gpt-5.6) | Lane B —— 鉴权、多租户边界、输入与注入 | `brief-B.md` | 2026-08-31 | 2026-08-31 | done | 同上，`out-B.md` |
| Vellum | Claude Code (Opus 5) | Lane C —— 前端、用户可见面、错误 UX | `brief-C.md` | 2026-08-31 | 2026-08-31 | done | 同上，`out-C.md` |
| Cadence | Codex (gpt-5.6) | Lane D —— 规格兑现、契约对齐、prompt↔数据流 | `brief-D.md` | 2026-08-31 | 2026-08-31 | done | 同上，`out-D.md` |

四条 lane 各自在 `main` 的 detached worktree 上只读审查同一个 commit `cd21614`，
互不写同一批字节。产出的发现已逐条核过证据，进 `issues_agentshow.json`（A-1 起）。

**下次同类活**：这四个攻击面的划分是有效的（A 与 B 独立撞上同一条 BLOCKER，
说明覆盖有重叠冗余但不浪费）。重跑时直接复用这四份 brief，把 CONTEXT.md 里
的「已记录在案的取舍不算发现」那段留着 —— 它挡掉了大量重复报告。
