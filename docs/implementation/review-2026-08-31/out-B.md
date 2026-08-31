## BLOCKER 实时 agent 路由是完整 IDOR：任意登录者可直连别人的 session，并把别人的 ProjectDO 当成自己的工具区
**证据**：源 `agentshow/src/server.ts:188-203` ↔ 目标 `agentshow/src/server.ts:152-183`；客户端公开了实例名拼法 `agentshow/src/ui/Chat.tsx:31-32`

**失败场景**：B 只要是三个允许域之一的登录用户，就能直接请求 `/agents/agent-d-o/ferrule:pricing/get-messages`。`fetch` 只做站点级 Access 校验，`handleApi` 对 `/agents/` 返回 `null`，随后不带 `email`、不查 WorkspaceDO、也不查 project membership 就调用 `routeAgentRequest`。目标 AgentDO 又直接从攻击者选定的实例名解析出 `agentId` / `projectId`，把该全局 ProjectDO 的读、写、评论、提及工具注入本轮。因此同一条通道既能读别人 session 历史，也能发消息驱动 victim agent 读取或改写 victim project。实际本地请求 `GET /agents/agent-d-o/victim:secret-project/get-messages` 收到 `200 []`；这个任意实例此前不在当前 `/api/me` 的 workspace 中，证明路由没有归属门禁。

**建议**：给 `routeAgentRequest` 同时配置 `onBeforeRequest` 和 `onBeforeConnect`，用已验证邮箱检查 owner-qualified agent 与 project 归属；AgentDO 的 `beforeTurn` 再做一次不可绕过的 owner/membership 校验。DO 名必须包含 owner，不要继续把裸 `${agentId}:${projectId}` 当安全边界。

## BLOCKER 同名 project 创建会把攻击者登记进受害者的全局 ProjectDO，REST 归属检查随即失效
**证据**：源 `agentshow/src/api.ts:209-225` ↔ 目标 `agentshow/src/api.ts:229-239`、`agentshow/src/api.ts:267-292`

**失败场景**：A 已有 project `tenant-collision-b`，其中 `secret.md` 内容为 `victim secret`。B 起初请求该 project 得到 404；B 随后调用 `POST /api/projects`，body 使用同一个 `projectId`。代码先把这个裸 id 加进 B 的 WorkspaceDO，再通过全局 `ProjectDO.idFromName(projectId)` 把 B 加进 A 的同一实例。此后 232-235 行的“自己的 workspace 有这个 id”检查变成真，B 调文件详情端点直接读到 A 的内容。临时 workers 测试实际得到：碰撞前 404，创建返回 201，随后文件详情 200 且 `content === "victim secret"`。

**建议**：ProjectDO 的实例名改为 `${verifiedOwner}/${projectId}`，WorkspaceDO 保存 owner-qualified 引用；同时在 ProjectDO 内保存不可变 owner，并让所有读写 RPC 校验调用者，避免任何单一索引被污染后自动获得数据权限。

## HIGH 同名 agent 创建可读取受害者 identityDoc，并覆盖其共享身份卡
**证据**：源 `agentshow/src/api.ts:186-197` ↔ 目标 `agentshow/src/api.ts:328-361`、`agentshow/src/agent-identity.ts:61-67`

**失败场景**：A 创建 `tenant-agent-b`，soul 为 `victim private soul`。B 起初访问身份卡得到 404；B 随后 `POST /api/agents` 使用同一 `agentId`，只传自己的 `name`、不传可选 `soul`。接口会覆盖全局 AgentIdentityDO 的 profile、保留原 soul，并把裸 id 加进 B 的 WorkspaceDO。B 再请求 `/api/agents/tenant-agent-b`，归属检查通过并返回 A 的 `identityDoc`。临时 workers 测试实际得到 200 和 `identityDoc === "victim private soul"`；A 后续 session 也会继续读取这一个被 B 改过的全局身份实例。

**建议**：AgentIdentityDO 和 AgentDO 都用 owner-qualified id；创建时对已存在但 owner 不同的对象 fail closed。不要用“WorkspaceDO 中出现裸 agentId”作为读取全局身份文档的授权证明。

## LOW seed 把真人 Access cookie 放进命令行参数，同机进程可从进程表读取
**证据**：源 `agentshow/scripts/seed.ts:4-11`、`agentshow/scripts/seed.ts:19-29` ↔ 目标 `agentshow/scripts/seed.ts:108-119`

**失败场景**：操作者按注释运行 `node scripts/seed.ts --cookie "CF_Authorization=…"`，脚本从 `process.argv` 取值后放入请求头。cookie 在脚本存活期间仍以明文留在 argv；本机用等价 dummy 参数实测，`ps -o command` 完整显示 `--cookie REVIEW_SECRET`。共享开发机、监控采集器或能读进程表的本地进程可拿到真人登录凭证。

**建议**：从 stdin、受限权限文件或环境变量读取 cookie，并删除 `--cookie` 参数；环境变量仍可能被同权限调试工具读取，但不会进入普通 `ps` 输出。

## 判决
FIX-FIRST。

Access 本身未找到绕过：`jwtVerify` 使用受信 JWKS 并校验 issuer/audience，JOSE 会校验已签 token 的 `exp`，不接受无签名算法；生产构建实测把调用点固化为 `isDev: false`。缺 `POLICY_AUD` / `TEAM_DOMAIN` 时返回 500，且 `verifyAccess` 位于 API、agent 路由和静态资源之前，`wrangler.jsonc:14-22` 的 `run_worker_first: true` 使静态资源与 WebSocket 握手都经过它。

输入与渲染面未确认其他漏洞：`SLUG` 阻止冒号和路径分隔符；`?path=` 虽未过 zod，但只作为已授权 ProjectDO 内 SQLite 的精确键查询，不是文件系统路径；文件内容、评论、聊天消息和活动句子均作为 React 文本节点渲染，未发现 `dangerouslySetInnerHTML`。未覆盖真实 Cloudflare Access 策略配置和线上真实 JWT 端到端；没有向 Workers AI 发模型请求，也没有验证浏览器 WebSocket 发消息后的完整推理回合，但 HTTP 任意实例路由和两条跨邮箱数据泄露已分别用真实本地请求与 workers 测试复现。
