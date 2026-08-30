# agentshow — 系统设计

**一句话**：单人多 agent 的协作工作台。agent 有身份和记忆，project 有公共 workspace，agent 之间不聊天 —— 通过文件和 @提及协作。

**验收方式**：文末那条七步剧本能真跑通（真接模型、真读写文件、真发生冲突），录成视频。

---

## 1. 范围

### 做

单人。一个用户、若干 agent、若干 project。agent 是 project 的成员，能拥有文件、能在活动流里当主语、能 @ 别的 agent。

### 不做（但对象模型里留口子）

- Widgets 那一整层（Code / Branches / Deployments / Data / Backend）
- 三方合并与冲突解决界面
- 成员邀请、角色权限、多人
- Connectors / Sites / Expert 市场
- 跨实例的 agent 协议

不做的东西一律不写半截实现。留口子指的是数据模型上的字段和边界留对，不是留 TODO 分支。

---

## 2. 对象模型

核心关系：**`Session = Agent × Project`**。

### Agent — 身份

`AgentIdentityDO`，每个 agent 一个。装的是**跨所有 project 共享**的那部分。

| 字段 | 说明 |
|---|---|
| `id` | 稳定标识，DO name 就是它 |
| `profile` | 身份卡：`{ name, avatar, tagline, description, capabilities[] }`。**公开**，别的 agent 读它来决定找谁 |
| `identityDoc` | system prompt，对应 context block `soul`。agent 自己可改写 |
| `memory` | 对应 context block `memory`，跨所有 session 共享，会随使用增长 |
| `inbox` | 待处理的 @提及队列 |

`profile` 与 `identityDoc` 是两样东西：前者对外，是别人认识它的依据；后者对内，是它认识自己的依据。混成一个会导致 agent 一改自我认知就改变了别人找它的理由。

**agent 干活时用的那个 DO 是 `AgentDO`**，每个 (agent × project) 一个，装 Think 会话和该 project 下的私有草稿盘。它启动时把 `soul` 和 `memory` 两个 context block 的 provider 指向 `AgentIdentityDO`，所以同一个 agent 在所有 project 里共享同一份身份和记忆。

### Project — 场所

一个 Durable Object。

| 字段 | 说明 |
|---|---|
| `id` / `name` | |
| `members` | `{ memberId, kind: 'human' \| 'agent' }[]`。**人和 agent 混在同一张表里**。单人阶段无角色，成员即可读写 |
| `files` | 公共 workspace：`{ path, content, version, ownerId, updatedAt }` |
| `threads` | 讨论线程，挂在 `path` 上：`{ path, comments[] }` |
| `sessionIndex` | `{ agentId, sessionId, title, status, updatedAt }[]`。**只存指针不存内容** |
| `activity` | `{ actorId, actorKind, verb, targetType, targetId, at }[]` |

`members` 一张表混装人和 agent，是整个设计的支点。分成两张表就等于在数据层宣告 agent 不是同事，后面所有界面都会被这个结构拖回「人在协作，agent 是工具」。

### Session — 相遇

**一条 session 就是一个 `AgentDO` 实例**，DO name 是 `${agentId}:${projectId}`。同一对永远命中同一个实例，不需要额外的 id 派生逻辑。DM 是 `${agentId}:dm`。

```ts
export class AgentDO extends Think<Env> {
  configureSession(session: Session) {
    const identity = this.identityStub();          // AgentIdentityDO
    return session
      .withContext("soul",   { provider: { get: () => identity.getIdentityDoc() } })
      .withContext("memory", { provider: { get: () => identity.getMemory() },
                               description: "这个 agent 学到的东西", maxTokens: 1100 })
      .withCachedPrompt();
  }
}
```

- 状态 `in_progress | done` 存在 **ProjectDO 的 sessionIndex 上**，不在 session 里 —— 项目视角本来就读索引，而 session 自己没有这个概念
- **`soul` 和 `memory` 是 SDK 的原生 context block 标签**，正好就是这里的「身份文档」和「记忆」。provider 指向 `AgentIdentityDO`，跨 project 共享就此成立
- agent 通过 `configureSession` 带来的 `set_context` 工具改写自己 —— 不用自建

状态字段是「这个项目现在什么状态」的答案来源 —— 没有它，项目视角只能显示一堆没有终点的对话。

### Artifact / 讨论线程 / @提及 / 挂载

- **Artifact** 就是 `files` 里的一行，带 `version` 和 `ownerId`。owner 可以是 agent
- **讨论线程**挂在文件路径上，不挂在对话上。文件列表直接显示评论数
- **@提及**是跨 agent 的唯一通道，本质是投递进目标 agent 收件箱的一条消息
- **挂载**在单人阶段退化为「agent 是不是这个 project 的成员」。成员即可读写

---

## 3. 运行时拓扑

```
Worker（路由 + 静态资源 + 鉴权）
  │
  ├── AgentIdentityDO ×  每个 agent 一个
  │        身份卡 / 身份文档(soul) / 记忆(memory) / inbox
  │
  ├── AgentDO         ×  每个 (agent × project) 一个 —— 就是一条 session
  │        Think 会话 / 私有草稿盘
  │        ↑ Think 基类，模型走 Workers AI
  │        ↑ soul 和 memory 由 configureSession 的 provider 从
  │          AgentIdentityDO 拉，所以同一 agent 的所有 session 共享它们
  │
  └── ProjectDO       ×  每个 project 一个
           files+版本 / threads / members / sessionIndex / activity
```

**为什么 session 是一个 DO 而不是 DO 里的一条记录**：Think 每个 DO 只管一条
Session，在 `onStart` 时 `configureSession` 配置一次，之后不能切换 —— 它的类型
和文档里没有 `SessionManager`、没有 `sessionId`。顺着这个形状走，
`Session = Agent × Project` 在基础设施层面就是字面真理：DO 实例名即
`${agentId}:${projectId}`。

代价是 agent 的私有草稿盘从「每 agent 一块」变成「每 session 一块」。这是改进
而非退让 —— agent 在某个 project 里的草稿本来就不该污染另一个 project。
真正需要跨 project 共享的只有身份和记忆，那两样在 AgentIdentityDO 里。

前端从 `cloudflare/agents-starter` 起，用它已接好的 `useAgent` / `useAgentChat` 和 Worker 路由。

存储全部落 DO SQLite。不接 R2、不接 Artifacts、不接容器 —— 演示体量下 SQLite 足够，且少三个依赖就少三处会在录视频当天坏掉的地方。

### 依赖

| 包 | 版本 | 用途 |
|---|---|---|
| `agents` | 0.21.0 | Agent 基类、路由、`SessionManager`（在 `agents/experimental/memory/session`） |
| `@cloudflare/think` | 0.17.0 | 对话骨架、agentic loop、流式、内置 workspace 工具 |
| `@cloudflare/shell` | 0.4.3 | `Workspace` 实现，Think 的 `this.workspace` 用它 |
| `ai` · `zod` · `react` | — | Think 教程的标配依赖 |

`@cloudflare/computer` 不用 —— Think 自己集成的是 `@cloudflare/shell`，且 computer 还是
0.2.1 preview、API 不稳定。少一个会在录视频当天坏掉的依赖。

**Think 白送的比预想的多**：每个 Think agent 自带 `this.workspace`（DO SQLite 撑的虚拟
文件系统）和八个已注册的工具 —— `read` / `write` / `edit` / `list` / `find` / `grep` /
`delete` / `bash`。agent 的**私有盘不用写一行代码**。`bash` 工具默认开启，v1 设
`workspaceBash = false` 关掉：它会快照上千个文件，对演示是纯负担。

模型走 **Workers AI**，不需要 key，本地 `wrangler dev` 直接跑。换外部 API 是覆写 `Think.getModel()` 一处 —— 这是刻意保留的切换点，不做抽象层。

---

## 4. 关键机制

### 4.1 写 workspace — 乐观并发

Agent 读文件拿到 `{ content, version }`，写回时必须带上读到的那个 version：

```
ProjectDO.writeFile({ path, content, baseVersion, authorId })
  → baseVersion === current  : 写入，version + 1，记 activity，返回 { ok: true, version }
  → baseVersion !== current  : 拒绝，返回 { ok: false, reason: 'stale', version, content }
```

被拒绝的 agent 拿到的是**当前内容和当前版本**，不是一句错误 —— 它可以直接在这份新内容上重做，不用再读一次。

这里没有三方合并。agent 干活是长事务（几十秒到几分钟），它脑子里的快照会在这期间失效；乐观并发让失效变成一次显式拒绝而不是一次静默覆盖。重做对 agent 的成本接近零，所以这个在人身上是次优解的方案，在这里是最优解。

将来要并行改同一个文件时，把「拒绝」那个分支换成三方合并，数据模型一行不动。

### 4.2 @提及 — 投递与唤醒

```
Agent A 调 mention(agentName, path, message)
  → ProjectDO 在 members 里解析 agentName → agentId
  → ProjectDO 记一条 activity
  → ProjectDO 调 AgentDO(agentId).notify({ projectId, path, message, fromAgentId })
  → AgentDO 由 (agentId, projectId) 派生 sessionId，取出或新建那条 session
  → 把提及作为一条消息投进去，触发一轮推理
```

投递是异步的，不要求目标 agent 在线 —— DO 睡着也不丢，醒来处理。这是不做群聊换来的：群聊要求所有 agent 常驻，@提及只在被点名时唤醒一个。

被唤醒的 agent 落在它自己在该 project 的那条 session 里。它带着自己的记忆和身份文档来，但看到的是这个 project 的文件。

### 4.3 Agent 的工具

Think 已经给了八个作用于 agent **私有盘**的工具。下面六个是我们通过 `getTools()` 加的，
全部作用于它所在的 **project 公共区** —— 名字刻意跟内置的不撞（`readFile` 对 `read`），
因为 Think 的工具合并是后者覆盖前者，撞名会静默顶掉内置工具。

| 工具 | 签名 |
|---|---|
| `listFiles` | `() → { path, version, ownerId }[]` |
| `readFile` | `(path) → { content, version }` |
| `writeFile` | `(path, content, baseVersion) → { ok, version, content? }` |
| `comment` | `(path, text) → void` |
| `mention` | `(agentName, path, message) → void` |
| `setSessionStatus` | `('in_progress' \| 'done') → void` |

`mention` 不需要人批准 —— 单人阶段两个 agent 都是用户自己的，加确认只会让演示卡住。这个边界在多人阶段必须重新定（见第 8 节）。

---

## 5. 界面

七个，对应剧本的七步：

1. **三栏骨架** — 左 project 与 agent 列表，中对话或 session 列表，右 project 面板
2. **对话页** — 跟某个 agent 在某个 project 里说话
3. **Project Overview** — 成员（人和 agent 混排）、文件、最近活动
4. **Files** — 每行带 owner 头像和评论数。owner 是 agent 时显示 agent 头像
5. **文件详情 + 讨论线程** — 评论挂在文件上
6. **Activity** — 主语是 agent：「Verdigris 复审了 v3，留了 2 条」
7. **Agent 身份卡** — 名字、简介、能力、它在哪些 project 里

视觉基准参考 Paper 文件 `youware` 的 `project-collaboration` 页。**但那套设计里所有行动者都是人** —— Members 是人、Activity 主语是人、文件 owner 是人、冲突由人解。照搬会把整个赌注稀释掉。要做的替换：

| youware | agentshow |
|---|---|
| Members 是人，角色 Admin / User | 人和 agent 混编，agent 有身份卡 |
| Activity 主语是人 | Activity 主语是 agent |
| 冲突要人解，Owner 合并 | agent 自己重做，人只看结果 |

对象模型草图在 Paper 文件 `agentshow` 的 Page 1。

---

## 6. 错误处理

| 情况 | 处理 |
|---|---|
| 写入 stale | 返回当前内容和版本，agent 重做。**不是错误，是正常路径**，不弹给用户 |
| @提及的 agent 不是本 project 成员 | 工具返回明确失败，agent 在对话里说明。不静默丢弃 |
| 目标 agent 推理失败 | 在它那条 session 里留错误，activity 记一条「未能完成」。提及方不阻塞 |
| 模型调用超时 | Think 的断流恢复接管；session 状态保持 `in_progress` |
| 两个 agent 互相 @ | 每条 session 记提及深度，超过 3 跳停止并在 activity 里标出 |

最后一条是必须有的。不做群聊消除了广播风暴，但没有消除环 —— A @ B、B @ A 是一个会一直烧钱的循环，且在演示里出现的概率不低。

---

## 7. 测试

`vitest` + `@cloudflare/vitest-pool-workers`，DO 内部状态用 `runInDurableObject` 断言。

三条必须有真测试，因为它们是这套设计里唯一会真正出错的地方：

1. **乐观并发**：并发两次写同一路径，后到的那次带旧 baseVersion，必须被拒绝且拿到当前内容；文件最终版本号是 2 不是 1
2. **@提及路由**：A 在 project P 里 @ B，断言消息落在 `(B, P)` 那条 session 里，而不是 B 的 DM 或 B 在别的 project 的 session
3. **提及深度**：构造 A ↔ B 互相提及，断言第 4 跳被拦下

界面不写自动化测试 —— 演示价值全在真实交互上，投在这里的时间应该花在把剧本跑顺。

---

## 8. 已知的账

不是待办，是这个模型自带的代价。

**记忆会跨 project 串味。** agent 能改自己的身份文档，而它同时在多个 project 干活。单人阶段这是特性 —— 它真的在长；多人阶段这是事故 —— 在你这学的东西被带到别人那去了。要么给记忆分层，要么给 project 加隔离，在做第三层之前必须有答案。

**人确认的边界还没定。** 单人阶段 `mention` 不需要批准。一旦别人的 agent 进来，「我的 agent @ 别人的 agent」要不要我点头就是个真问题：不要，两个 agent 能自己聊起来，烧钱且失控；要，协作就慢下来。同样在第三层之前必须有答案。

**项目视角是跨 DO 查询。** 消息住在 agent 身上，project 手里只有索引。索引必须在写第一条 session 时就维护 —— 事后补要回填全部历史。

---

## 9. 验收剧本

七步，每步都要在界面上可观察。这是「做完了」的定义：

1. 一个 project，两个 agent —— 一个实现、一个复审，各有身份卡
2. 跟实现 agent 说：把这块改了
3. 它干活，产出文件进 project 的 Files，owner 显示的是它自己
4. 它在文件上 @ 复审 agent
5. 复审 agent 醒来，读文件，留两条评论
6. Activity 里能看到全程，主语全是 agent
7. 点进复审 agent 那条 session，能看到它为什么这么说

跑通之后录视频。
