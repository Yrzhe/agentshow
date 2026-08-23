# 这是一条 multiplayer 探索线

产品名先叫 Cloudflare OS Multiplayer。目标：同一个 project / workspace 里协作，但每人用自己的 agent，看不到别人的 chat。官方 Cloudflare OS 做不到，所以我们改核心。

## 仓库怎么摆

- 外壳：`Yrzhe/cloudflare-os-starter`（准备改名为 `cloudflare-os-multiplayer`）
- 核心 fork：`Yrzhe/cloudflare-os`，分支 `multiplayer`
- 官方对照：`cloudflare/cloudflare-os`、`cloudflare/cloudflare-os-starter`
- 当前 pin 写在 [upstream-pin.md](upstream-pin.md)

子模块指向我们自己的核心 fork，改聊天可见性、协作模型，都打在 `Yrzhe/cloudflare-os` 的 `multiplayer` 上，不要直接在外壳里摊开官方源码。

## 现在可以动核心

多人协作探索允许改 `cloudflare-os/` 里这些：

- 聊天归属和可见性（按人隔离）
- workspace / project 分享以后谁能进哪条 chat
- 右侧共享资产（文件、widget、知识库）如果官方模型不够

能放在外壳里的仍然放外壳：`deployment.jsonc`、`packages/` 自建 Gatekeeper、`/admin`、我们的文档和 CI。

## 仍然不要盲跟官方

官方 `main` 只借鉴，不自动合。升 pin 之前对一下 [upstream-pin.md](upstream-pin.md)。CI 继续保证外壳里的 `cloudflare-os` 是子模块指针，并在官方超前时给提示。
