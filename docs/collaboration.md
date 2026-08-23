# 以 project 为单位的协作

目标：一个团队在同一个 project 里协作，但**每个人操作自己的 agent，看不到别人的 chat**。

官方 Cloudflare OS 里把人加进一个 gadget，等于大家一起对着同一条 chat 说话（见
`cloudflare-os/docs/sharing.md`）。这不是我们要的协作——那是共用一个终端。我们要的是：chat 归个人，
**project 才是共享的那一层**。

## 为什么做成 Gatekeeper，而不是改核心

[what-we-own.md](what-we-own.md) 允许改 `cloudflare-os/`，但协作这一层放在外壳里更合适，理由不是"怕
改核心"，而是这层东西的形状本来就是 Gatekeeper：

- **隔离是免费得到的，不是实现出来的。** 每个人的 agent 连的是自己的 gatekeeper facet，带自己的
  account id。共享的只有 facet 背后的那些 project Durable Object，而每个 DO 的每个方法都按 member
  回答。"看不到别人的 chat"不需要写代码保证——chat 从来没进过这一层。
- **审批和可观测性已经有了。** Gatekeeper 的 approval queue 和 observation 授权是现成的，写操作要人
  点头、读操作要登记，都不用自己发明一套。
- **升官方 pin 时不会打架。** 协作的数据和逻辑全在我们自己的 Worker 里，官方改 chat 的存储结构不会
  牵动它。

所以核心 fork 那条线（`Yrzhe/cloudflare-os` 的 `multiplayer`）留给真正只能在核心做的事：左侧产品路由
里的 project 入口、右侧功能区的挂载点。**数据、权限、审批全在这个 Worker 里**。

## 面板怎么对应

| 面板 | 这一层提供什么 |
| --- | --- |
| 左侧产品路由 | `listProjects()` 是 project 列表的数据源；每个 project 有自己的 URL |
| 中间对话 session | 完全不碰。每人一条自己的 chat，agent 通过 `openProject()` 拿到共享内容 |
| 右侧功能区 | 文件和 comment 从 `listFiles()` / `listComments()` 来；文件链接可以直接在浏览器里打开 |

## 数据放在哪

| 东西 | 放在哪 | 为什么 |
| --- | --- | --- |
| project 的成员、文件元数据、comment、环境变量 | 每个 project 一个 `ProjectDurableObject`（SQLite） | 一个 project 就是一个一致性边界，权限判断全在这一个地方 |
| 文件字节 | R2（`PROJECT_FILES`） | DO 存储单值上限 2 MB，装不下文档 |
| 某个人加入了哪些 project | 每个账号一个 `MemberProjectsDurableObject` | 列自己的 project 不用去问每一个 project |
| 待审批的动作 | `ProjectGatekeeper` facet 自己的存储 | 审批是个人的事，不该让别人看见你在等什么 |

`MemberProjectsDurableObject` 是**索引，不是事实来源**。成员关系记在 project 里，所以索引里的条目可能
比成员关系活得久——project owner 把人踢掉时不会伸手去改那个人的账号。列 project 的时候会拿每个 id 去
问对应的 project"这个人能看到什么"，答"什么都看不到"的就顺手删掉。

## 工作区：三种可见性

```
private   只有自己能读，虽然文件在 project 里
project   project 的每个成员都能读
public    任何能访问到这个 deployment、并且拿到链接的人都能读
```

`public` 那句"能访问到这个 deployment"是字面意思：这个部署跑在 Cloudflare Access 后面，所以 public
文件仍然在 Access 的边界内。它不是"公网可见"。

### 路径就是意图

`shared/` 下面的文件默认 `project` 可见，其它地方默认 `private`。

这不是额外的规则，而是**把人本来就会做的动作当成表达**：拖进 shared 文件夹就是分享，拖出来就是收回。
所以 `moveFile()` 同时改路径和可见性——如果拆成两个操作，就会出现一个躺在 `shared/` 里但仍然是
private 的文件，没人能解释它。

唯一的例外是 `public`：发布是个足够慎重的决定，改个名字不该把它悄悄撤回，所以 public 文件搬到哪里都
还是 public。

### 只能改自己的文件

任何成员都能读 project 里共享的东西，但**只有文件的 owner 能覆盖它**，project owner 也不行。project
是发表自己的东西、并且对别人的东西提意见的地方，不是互相改稿的地方。想改别人的，用 `copyFile()` 拿
一份自己的。

删除是唯一的例外：project owner 可以删任何文件，因为需要有人能清场。

## comment：三个级别

| anchor | 用在哪 |
| --- | --- |
| `{ kind: "file" }` | 整篇文档 |
| `{ kind: "page", page }` | 分页文档的某一页（PDF 之类） |
| `{ kind: "text", start, end, quote }` | 字符级。`quote` 是必填的 |

`quote` 必填是因为 comment 要比它锚定的那次编辑活得久。偏移量在文件被改写之后就不可靠了，把原文一起
存下来，至少还能把 comment 显示在对的地方附近。字符偏移量算的是 `readFile()` 返回的那个字符串。

**public 文件上的 comment 只有成员能看。** 发表一篇文档不等于发表关于它的讨论。实现上不需要特别处
理：读 comment 的每条路径都要求一个 member id，而 HTTP 请求（也就是拿着 public 链接来的人）根本没有
member id。

## 数据资产：skill 与环境变量

**skill 就是带 `skillName` 的普通共享文件。** 没有单独的 skill 存储，因为 skill 需要的东西（分享、
comment、版本归属）和文件完全一样。`listSkills()` 只是 `listFiles({ skillsOnly: true })`。这样"分享
skill → 在上面 comment"就是免费的。

**环境变量是 project 级的，任何成员都能读写。** 它们是这个 project 商定的设置——共享 skill 或者
widget 要能对所有人跑起来就得有这些值——所以边界就是成员关系，不再往下切。名字限制成环境变量本来的形
状（`[A-Za-z_][A-Za-z0-9_]*`），因为这些值最终要交给 widget 的环境，一个在那里拼不出来的名字，会在比
校验晚得多的地方才出错。

`listEnvVars()` 只给名字不给值，取值要单独调 `getEnvVar()`——列出来的东西经常会整个进 agent 的上下
文，值不该跟着一起进去。

## 链接

每个 project 和每个文件都有地址，同一个字符串同时干三件事：人点开、agent 引用、Worker 自己的 fetch
handler 解析回来。

```
https://<origin>/gatekeeper/project/p/<projectId>          project
https://<origin>/gatekeeper/project/f/<projectId>/<fileId> 文件字节
```

`/gatekeeper/project` 这个前缀是 router 里 `GATEKEEPER_PROJECT` 这个 binding 名字定的，不是配置出
来的。

- **project 链接打开是一个说明页，什么都不透露。** HTTP 请求没有身份，回答不了"谁在问"，而一个写着
  project 名字的页面会把只有成员该知道的事告诉任何拿到链接的人。这个链接的用处是被 agent 认出来。
- **public 文件的链接是稳定的**，其它文件的链接**签了名并且会过期**（10 分钟）。签名的 key 不出
  `ProjectDurableObject`，签的内容包含 fileId 和过期时间，所以一个 token 只能证明"签它的时候，签的人
  确实能读这个文件"——既不能挪到别的文件上，也不能自己把有效期改长。

## 写操作要人点头

Gatekeeper 的写操作走 approval queue。这里的做法是**计划 / 提交两段**：

- `planWrite()` 在 agent 提出请求的当下跑，检查配额、路径占用、能不能覆盖。它的作用是把"你不能覆盖别
  人的文件"变成一个 agent **当场就能改的错误**。
- `commitWrite()` 在人点头之后跑，是**真正生效的那道门**。

两边都查是故意的，不是重复。只有 `planWrite()` 会让越权在审批之后才失败，只有 `commitWrite()` 会让审
批期间发生的变化被忽略。

被拒绝的 `writeFile` 会把已经放进 R2 的字节删掉；被撤回（revert）的动作各自有各自的撤法，`actions.ts`
里一条条列着。有些动作明确不可撤——比如 `createProject` 和 `removeMember`——撤回它们会牵动别人的东西。

## observer 校验（Strategy C）

一个 project 被多个人看着，而**能看到什么是会变的**：文件可以从 project 可见改回 private，成员可以被
移出。所以观察记录不能只记"这个人当时读到了什么"，还要能被重新校验。

登记两种集合：

```
p:<projectId>            project 里每个成员都能读的东西
f:<projectId>:<fileId>   某一个文件，它的可见性以后可能收窄
```

public 文件不登记任何集合——没有人需要被挡在外面。

校验是**对当前状态实时回答的**，这正是它的用处：一个在文件还是 project 可见时通过校验的 observer，在
owner 把它改回 private 之后就通不过了。

## 配额（付费点）

| 变量 | 默认 | 管什么 |
| --- | --- | --- |
| `PROJECT_MAX_FILE_BYTES` | 10 MiB | 单个文件 |
| `PROJECT_MAX_TOTAL_BYTES` | 1 GiB | 一个 project 的总字节 |
| `PROJECT_MAX_FILE_COUNT` | 2000 | 一个 project 的文件数 |

在 `deployment.jsonc` 的 `project.limits` 里改。这是部署级的决定，也是花钱的那一维：字节记在这个部署
自己的 R2 bucket 上。

覆盖一个文件只按差额计费，所以把一个已经顶到上限的文件重写一遍不会因为"装不下"被拒。

## 部署

```jsonc
"workers": { "project": { "name": "<PROJECT_WORKER_NAME>" } },
"project": {
  "sharingDomain": null,          // null 用公开 origin
  "filesBucket": null,            // null 让 wrangler 自动开一个
  "limits": { /* 见上表 */ }
}
```

`sharingDomain` 隔离的是"哪些 project 属于这个部署"，和 `context.sharingDomain` 是同一种东西。**改
它的唯一后果是安静的**：现有的 project 一个都不会消失，但一个都看不见了。如果这个部署的公开 origin
可能搬家，就把它显式写死。

它出现在两个地方，必须一致：Workshop 那条 binding 上的 prop（决定一次 session 在哪个域里工作），和这
个 Worker 自己的 `PROJECT_SHARING_DOMAIN`（决定它的 fetch handler 在哪个域里解析一个文件链接）。
`scripts/deploy.test.ts` 会检查两边相等。

## 还没做的

- **widget 协作**：project 内的 mini app（EdgeSpark 前后端 + init 时带 skill 文件夹的 agent native
  app），以及 view → issue → git。环境变量和 skill 这两块地基已经在了。
- **实时协同编辑**：明确不做。这一层是 view → comment。官方用 Yjs 做 gadget 代码的实时编辑，文档没有
  走这条路。
- **文件的 git 语义**：`moveFile()` / `copyFile()` 之外没有历史和分支。
- **URL 寻址的资源**：只提供一个单例的 `ProjectDirectory` binding，agent 通过 `listProjects()` 和
  `openProject()` 进去。做 URL 寻址要连带做 configurator UI，不值得。
- **上传后的处理**：文件按原样存。PDF 之类只能做页级 comment，因为没有抽出文本。
