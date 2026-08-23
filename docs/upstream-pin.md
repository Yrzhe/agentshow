# 官方版本记录

记于 2026-08-23（Asia/Shanghai）。以后对照官方有没有可借鉴的更新，先看这里，再决定要不要升。

不要自动跟 `cloudflare/cloudflare-os` 的 `main`。官方升级可能带 Durable Object 迁移。

## 我们现在钉住的版本

| 东西 | 仓库 | 提交 | 说明 |
| --- | --- | --- | --- |
| 线上 / starter 子模块 | `cloudflare/cloudflare-os` | `6478a1448a11524e2f7c2575ad66fab0bc47c433` | 2026-08-19，`harden missing file handling during gadget export` |
| 当时官方 `main` | 同上 | `1ef6020a42fbabb6d27dd1063db3a075ba95c974` | 2026-08-21，git storage / CodeMirror 大改，已经超前 |
| 外壳 starter | `Yrzhe/cloudflare-os-starter` | 以当时 `main` 为准 | 可改名为 `cloudflare-os-multiplayer` |
| 核心 fork | `Yrzhe/cloudflare-os` | 分支 `multiplayer` 现从官方 `main`（`1ef6020`）分出 | 多人协作的改动打在这里 |

核对：

```sh
bash scripts/check-owned-paths.sh
```

升官方时：先看官方 commit 说明和 DO 迁移，再把子模块指针往前挪，合进 `multiplayer`，不要直接覆盖我们的协作改动。
