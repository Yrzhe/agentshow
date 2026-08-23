# 能动什么，不能动什么

这份说明是我们自己的约定，给以后改这个仓库的人和云 Agent 看。官方更新走 `cloudflare-os` 子模块，不要改子模块里面的源码。

## Agent 自带的沙箱

Cloudflare OS 已经自带隔离，不必先接容器 Sandbox：

- Agent 的 `executeCode`：Workers 里跑一段 JS，不能直接上网，只能走这次对话里介绍给它的 `env` 绑定。
- Gadget：服务端是 Dynamic Worker，客户端是 iframe。默认谁也碰不到外网，除非你把某个资源介绍进去。

容器 Sandbox（`@cloudflare/sandbox`）是另外一层，给要跑 Python、git、大命令的任务用。那是我们以后可以加的东西，加在仓库外圈，不要补丁打进 `cloudflare-os/`。

## 不能动（跟着官方走）

这些只许以「升级子模块指针」的方式更新，禁止直接改文件：

- `cloudflare-os/` 整棵树（workshop、官方 Gatekeeper、前端、官方 scripts）
- 子模块必须保持 gitlink（mode `160000`），不能把官方源码复制成普通目录

官方变了，我们变的方式是：记下当前 pin → 把 `cloudflare-os` 指到新的官方 commit → 看 diff、跑检查 → 再部署。不要设置成官方 `main` 一推我们就自动跟上。官方升级可能带 Durable Object 迁移，盲跟会弄坏线上数据。

## 能动（我们自己的）

只在这些地方加功能、改配置：

| 地方 | 干什么 |
| --- | --- |
| `/admin` | 站名、logo、颜色、公告。不用改仓库。 |
| `deployment.jsonc` | Worker 名、域名、Access、AI、存储 ID。 |
| `packages/` 里我们自己的包 | 自定义 Gatekeeper、以后要加的容器 Sandbox 工具。 |
| `docs/what-we-own.md`、`.github/`、`scripts/check-owned-paths.sh` | 我们的约定和核对。 |
| Wrangler secrets | OAuth Client Secret 等部署密钥。不要写进 git。 |

新集成写成 `packages/` 下一个包，用 service binding 挂上去，不要去改 `cloudflare-os/packages/...`。

官方 starter 自带的 `docs/customization.md`、`docs/migrate-from-hosted.md`、`scripts/deploy.ts` 尽量少动。要改部署脚本，先确认官方同文件有没有更新，避免下次升 pin 时难合。

## 和官方怎么对齐

- `origin`：`Yrzhe/cloudflare-os-starter`（我们的仓库）
- `upstream`：`cloudflare/cloudflare-os-starter`（官方外壳）
- 子模块 `cloudflare-os`：`cloudflare/cloudflare-os`（官方核心）

CI 会核对：`cloudflare-os` 仍是子模块，里面没有被当成普通文件提交；并对比官方 `main`，如果我们的 pin 落后，只出提示，不自动 bump，也不因此失败。

本地升级官方核心：

```sh
cd cloudflare-os
git fetch origin
git checkout <官方 commit>
cd ..
git add cloudflare-os
# 再跑 pnpm install → pnpm check，确认后再 commit
```
