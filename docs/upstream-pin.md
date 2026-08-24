# 官方版本记录

记于 2026-08-24（Asia/Shanghai），上一次记于 2026-08-23。以后对照官方有没有可借鉴的更新，先看这里，再决定要不要升。

不要自动跟 `cloudflare/cloudflare-os` 的 `main`。官方升级可能带 Durable Object 迁移。

## 我们现在钉住的版本

| 东西 | 仓库 | 提交 | 说明 |
| --- | --- | --- | --- |
| 线上 / starter 子模块 | `cloudflare/cloudflare-os` | `1ef6020a42fbabb6d27dd1063db3a075ba95c974` | 2026-08-21，`Convert backing storage to git, change sync to OT, editor widget to CodeMirror`（#275） |
| 上一个 pin | 同上 | `6478a1448a11524e2f7c2575ad66fab0bc47c433` | 2026-08-19，`harden missing file handling during gadget export`。已被上面这个快进取代 |
| 外壳 starter | `Yrzhe/cloudflare-os-starter` | 以当时 `main` 为准 | 可改名为 `cloudflare-os-multiplayer` |
| 核心 fork | `Yrzhe/cloudflare-os` | `main` 与 `multiplayer` 都在 `1ef6020` | 子模块 URL 指向这里；多人协作的改动打在 `multiplayer` 上 |

`1ef6020` 是官方 `main` 的原始提交，不是我们重放出来的：`Yrzhe/cloudflare-os` 与
`cloudflare/cloudflare-os` 的 `refs/heads/main` 是同一个 SHA，`6478a144` 是它的祖先（15 个提交的快进）。

核对：

```sh
bash scripts/check-owned-paths.sh
```

## 这次升 pin 顺带改了什么

- `pnpm-workspace.yaml` 的 catalog 跟着子模块走：`capnweb` `^0.11.1` → `^0.12.0`，
  `capnweb-validate` `0.2.4` → `0.3.0`。**这个必须跟**：`cloudflare-os/packages/workshop-shared`
  和 `.../error-reporting` 是外壳 workspace 的成员，它们的 `catalog:` 在这里解析。版本对不上不会报错，
  只会装出两份 `capnweb`，然后一边铸出来的 stub 在另一边的 session 里序列化失败。
- `pnpm-lock.yaml` 跟着重装。`workshop-shared` 这次新增了 `@codemirror/state` 和 `fast-diff`，
  因为它是外壳 workspace 的成员，所以外壳的 lockfile 里也要有。
- `docs/collaboration.md` 里"官方用 Yjs 做 gadget 代码的实时编辑"这句话已经不成立了，改掉。

外壳这边没有别的要改：官方的 `wrangler.jsonc` 一个都没动，`scripts/pnpm-command.ts`、
`scripts/bin-entry.ts`、`scripts/release/manifest-lib.ts`、`scripts/assert-workerd.ts`、
`tsconfig.json` 也都没动，`workshop-shared/src/gatekeeper.ts` 这个 Gatekeeper 契约文件同样没动，
所以 `packages/gatekeeper-project` 和 `packages/custom-gatekeeper` 不受影响。
没有 package 把 `build` 脚本换成 Vite+ task，`buildCommands()` 照旧。

## #275 带来的存储迁移

没有新的 wrangler `migrations` tag（还是 v0/v1/v2），但**有一次 DO 内部的存储格式迁移**：
`packages/workshop-backend/src/git-migration.ts` 在 Overseer 构造函数里、`blockConcurrencyWhile`
下面跑，由 `version` singleton 把门。它把旧的 Yjs 代码日志重放成真的 git commit，再把每条 live chat
转成 commit-pinned 的 change-stream 表示。

它是可重跑的（对象写入是内容寻址的，记录改写从存储状态确定性推出），但**方向是单向的**：转换前的消息
虽然把旧的 Yjs `update` 字节留在盘上当保险，投递时会被剥掉，没有代码能再把它们应用回去。所以从
`1ef6020` 往 `6478a144` 回滚不是一次 Worker version rollback 能解决的事，先看
`.agents/skills/cloudflare-os-operator/references/upgrade-and-rollback.md` 里的回滚矩阵。

升官方时：先看官方 commit 说明和 DO 迁移，再把子模块指针往前挪，合进 `multiplayer`，不要直接覆盖我们的协作改动。
