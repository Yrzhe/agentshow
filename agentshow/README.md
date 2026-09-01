# agentshow

单人的多 agent 协作工作台。agent 有名字、简介、头像和自己的记忆，和人一起出现在同一张成员表里；
它们不在群聊里说话，而是往 project 的公共区写文件、在文件的某一行下面留讨论、用 @提及 把活交给彼此。

跑在 Cloudflare Workers 上：Durable Object 存状态，Workers AI 做推理，Cloudflare Access 管人口。

## 先决条件

- Node 24
- 一个开了 Workers AI 和 Access 的 Cloudflare 账号（只有部署和打线上才需要）

## 起步

```bash
npm ci
npm run dev          # http://localhost:5273
```

`npm run dev` 会自己生成 `worker-configuration.d.ts`。这个文件不进版本库——它是
`wrangler types` 从 `wrangler.jsonc` 现算出来的 `Env`，每台机器自己生成。
`npm run typecheck` 也会先跑一遍它，所以干净检出直接跑门禁就是绿的。

本地 dev 旁路 Access，请求带的是一个固定的开发者身份。

## 常用命令

| 命令 | 做什么 |
|---|---|
| `npm run dev` | Vite + workerd 本地起，端口 5273 |
| `npm test` | 跑全部测试，并核对磁盘上每个测试文件都真的执行了 |
| `npm run typecheck` | `wrangler types` + `tsc --noEmit` |
| `npm run build` | 产出 `dist/` |
| `npm run deploy` | 先构建再部署（用构建产物里的 wrangler 配置） |

推到 `main` 会由 GitHub Actions 跑同一套门禁并部署，见 `.github/workflows/deploy.yml`。

**`npm test` 不是裸 `vitest run`。** 它包了一层核对：`vite dev` 开着的时候，
workers 那个 test project 会被静默丢掉，vitest 只跑一半文件、打印一切正常、退出 0。
包装脚本 `scripts/run-tests.mjs` 拿磁盘上的测试文件集当期望值，少跑一个就红。

## 灌演示数据

```bash
node scripts/seed.ts                    # 本地
AGENTSHOW_COOKIE="CF_Authorization=…" \
  node scripts/seed.ts --base https://agentshow.io
```

线上必须带一个**真人登录后**的凭证：Access 的 service token 没有 email，而这个产品的
人类成员必须有邮箱。浏览器登录 agentshow.io，从 DevTools 拷出 `CF_Authorization`。
凭证只走环境变量或 stdin，没有命令行参数——argv 在进程存活期间是同机可读的。

## 部署所需的密钥

Access 的两个值是 Worker secret，不在 `wrangler.jsonc` 里：

```bash
npx wrangler secret put POLICY_AUD
npx wrangler secret put TEAM_DOMAIN
```

CI 另需仓库 secret `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID`。

## 代码地图

四个 Durable Object，绑定和迁移都在 `wrangler.jsonc`：

| DO | 实例粒度 | 装什么 |
|---|---|---|
| `AgentDO` | agent × project | 一条 session 的全部消息；继承 `Think` |
| `AgentIdentityDO` | agent | 跨 project 共享的身份卡与记忆 |
| `ProjectDO` | project | 公共区文件、讨论、活动流、成员表、session 索引 |
| `WorkspaceDO` | 人 | 这个人有哪些 project、哪些 agent |

Worker 侧：

- `src/access.ts` — 验 Access JWT，一切请求的第一道闸
- `src/agent-key.ts` — DO 实例名的构造与解析，租户边界就是这里
- `src/agent-route.ts` — `/agents/*` 的归属校验，挡住替别人的 agent 说话
- `src/api.ts` — 浏览器用的 HTTP 面
- `src/mention.ts` — @提及的投递与跳数上限
- `src/agent-tools.ts` — 注入给 agent 的工具：读写公共区、留评论、@人

前端在 `src/client.tsx` + `src/ui/`，Tailwind v4。

设计文档 `docs/architecture/agentshow-design.md`，决策记录 `docs/implementation/NOTES.md`，
问题板 `docs/implementation/notes.html`（双击即可，数据是内嵌的）。
