# 这是一条 multiplayer 探索线

产品名先叫 Cloudflare OS Multiplayer。目标：同一个 project / workspace 里协作，但每人用自己的 agent，看不到别人的 chat。官方 Cloudflare OS 没这一层，所以这一层归我们做。

## 仓库怎么摆

- 外壳：`Yrzhe/cloudflare-os-starter`（准备改名为 `cloudflare-os-multiplayer`）
- 核心 fork：`Yrzhe/cloudflare-os`，分支 `multiplayer`
- 官方对照：`cloudflare/cloudflare-os`、`cloudflare/cloudflare-os-starter`
- 当前 pin 写在 [upstream-pin.md](upstream-pin.md)

子模块指向我们自己的核心 fork。真要改核心，就打在 `Yrzhe/cloudflare-os` 的 `multiplayer` 上，不要直接在外壳里摊开官方源码。

## 协作那一层在外壳里

协作本身做成了一个我们自己的 Gatekeeper：`packages/gatekeeper-project`。project 的成员、共享文件、
comment、skill、环境变量、widget 全在那里，chat 一点都不碰。设计和取舍写在
[collaboration.md](collaboration.md)。

数据和权限都留在这个 Gatekeeper 里，不往核心搬——它自己就是 project 的鉴权边界，每个方法都带调用者的
member id。

widget（project 里的 mini app）也整个在这里：它的前端、它内置的 `api/store`，都由这个 Worker 自己的
fetch handler 提供；自己写的 `backend.js` 跑在 Worker Loader 起的 isolate 里，而那个 binding 是可选的。
它现在只有一个自己的地址，**没有**动左侧导航或任何官方 UI。

## 核心只做界面入口

多人协作这条线里，`cloudflare-os/` 只改真正只能在核心改的东西：

- 左侧的 project 路由入口
- 右侧功能区的挂载点，widget 要嵌进面板的话也走这里
- 聊天归属和可见性（按人隔离），如果官方模型不够

共享资产（文件、skill、环境变量、widget）不算在内：那些是 Gatekeeper 的数据，核心只负责把它显示出来。
剩下的一律放外壳：`deployment.jsonc`、`packages/` 自建 Gatekeeper、`/admin`、我们的文档和 CI。

## 登录也在外壳里解决

`packages/email-code-idp` 是外壳里第二类自建 Worker——不是 Gatekeeper，是一个 OIDC provider。它只做一件
事：发验证码邮件，且邮件里**不放任何链接**。

起因是 Cloudflare 自带的 one-time PIN 邮件同时带验证码和登录链接，两者共用一次性额度，邮件安全网关扫链接
就把码用掉了，用户再输就被告知"已被使用"。官方给的解法是把发件人加白名单；加不了白名单的部署就没有第二条
路，因为那封邮件是 Cloudflare 的，模板不可配置。

关键是：这换的是 provider，不是架构。Access 仍然挡在应用前面，router 仍然占公共 origin，Workshop 仍然认同
一个签名 JWT 里的同一个 `email` claim。核心一行没动，这也是它该待在外壳里的原因。默认关闭——能加白名单的
部署就别开。细节在 [customization.md](customization.md#email-codes-without-the-allowlist)。

## 仍然不要盲跟官方

官方 `main` 只借鉴，不自动合。升 pin 之前对一下 [upstream-pin.md](upstream-pin.md)。CI 继续保证外壳里的 `cloudflare-os` 是子模块指针，并在官方超前时给提示。
