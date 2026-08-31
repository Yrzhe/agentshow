# Lane B —— 鉴权、多租户边界、输入与注入

先读 /tmp/agentshow-review/CONTEXT.md（共享上下文 + 硬性要求 + 交付格式）。
worktree：/tmp/agentshow-review/wt-B     输出：/tmp/agentshow-review/out-B.md    代号：B

## 你的攻击面

这个东西部署在公网 agentshow.io，前面挂 Cloudflare Access，放行三个邮箱域
（yrzhe.space / youware.com / arco.ai）—— **也就是说会有多个真人能登录**。
你的任务是找出「第二个人登录之后会发生什么坏事」。

具体查这些（不限于）：

1. **Access 校验**（`agentshow/src/access.ts`）——
   逐条核 JWT 校验：issuer / audience / 过期 / 算法。有没有可以绕过的路径？
   `isDev` 分支在生产构建里真的不可达吗（去 `src/server.ts` 看它怎么传的，
   再去 vite/wrangler 配置确认 `import.meta.env.DEV` 在部署产物里是什么值）？
   **这一条要给出确凿结论，不要「应该没问题」。**

2. **DO 命名空间是全局的** —— `ProjectDO` 按 `idFromName(projectId)` 寻址，
   `AgentIdentityDO` 按 `idFromName(agentId)`。NOTES.md 里已记了这条 open-question。
   你的任务不是重复它，而是**穷举所有可达路径**：除了「两人建同名 project」，
   还有哪些入口能让 A 触到 B 的数据？把每条路径的 file:line 给全。
   特别看 `agentKey` / `parseAgentKey`（`src/agent-key.ts`）和 `useAgent` 的实例名怎么来的 ——
   前端传的 `name` 有没有被服务端校验过？

3. **`routeAgentRequest` 的授权**（`src/server.ts`）——
   Access 只验了「这个人能进这个站」。进来之后，
   浏览器能不能直接连到**不属于自己**的 `${agentId}:${projectId}` 那条 session？
   `routeAgentRequest` 有没有做任何归属检查？如果没有，构造出完整的越权链条。

4. **API 的输入校验**（`src/api.ts`）——
   逐个端点核 zod schema。`SLUG` 正则挡住了什么、没挡住什么？
   路径参数、查询参数、body 里有没有没过 schema 就用的字段？
   `?path=` 这个查询参数直接进 `readFile`，能不能读到不该读的东西？

5. **XSS / 注入** —— 前端把 agent 生成的内容渲染出来（`src/ui/FileDetail.tsx`
   的评论正文和文件内容、`src/ui/Chat.tsx` 的消息、`src/ui/rows.tsx` 的活动流句子）。
   agent 是不可信输入源（它读了什么就可能吐什么）。逐处确认转义。
   有没有 `dangerouslySetInnerHTML`？有没有把用户/agent 内容拼进 URL / style / SVG？

6. **秘密与配置** —— `wrangler.jsonc`、`.github/workflows/deploy.yml`、
   `scripts/seed.ts`（它接受一个 cookie 参数）。有没有泄露路径？
   seed 脚本把 cookie 放进进程参数（`ps` 可见），这个风险值不值得提？

7. **fail-closed** —— `access.ts` 缺配置时返回 500。核实这条在所有路径上都成立，
   包括 WebSocket 握手和静态资源（`wrangler.jsonc` 的 `run_worker_first`）。

请**实际发请求验证**你能验证的部分（本地 `npx vite dev --port 5299` 起一个，
dev 模式会绕过 Access，正好用来验「绕过 Access 之后能干什么」这一类问题）。
跑完记得把 dev 关掉。报告里写明你实际发了什么请求、收到什么。
