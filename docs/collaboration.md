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

widget 现在**没有**挂进任何面板：`getWidgetLink()` 给的是一个在新标签页里打开的地址。左侧导航项和其它
官方 UI 一个字都没改——那条线归核心 fork。

## 数据放在哪

| 东西 | 放在哪 | 为什么 |
| --- | --- | --- |
| project 的成员、文件元数据、comment、环境变量、widget 元数据 | 每个 project 一个 `ProjectDurableObject`（SQLite） | 一个 project 就是一个一致性边界，权限判断全在这一个地方 |
| 文件字节，widget 的文件也在内 | R2（`PROJECT_FILES`），widget 的走 `…/widgets/` 前缀 | DO 存储单值上限 2 MB，装不下文档 |
| 某个人加入了哪些 project | 每个账号一个 `MemberProjectsDurableObject` | 列自己的 project 不用去问每一个 project |
| 一个 widget 存的东西 | 每个 widget 一个 `WidgetStoreDurableObject` | 一个 widget 能碰到的存储只该是属于它自己的那一点。它自己的前端通过 `api/store` 用它，它自己写的后端通过 `env.STORE` 用它，两条路进的是同一个对象 |
| 待审批的动作 | `ProjectGatekeeper` facet 自己的存储 | 审批是个人的事，不该让别人看见你在等什么 |

widget 的两张表（`widgets`、`widget_files`）和其它表一样是 `CREATE TABLE IF NOT EXISTS`，**只增不改**：
现有的 project 和文件一行都不用动。wrangler 的 migration 也一样，`v0` 还是当天那三个类，
`WidgetStoreDurableObject` 走一条自己的 `v1`。

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

每个 project、每个文件、每个 widget 都有地址，同一个字符串同时干三件事：人点开、agent 引用、Worker
自己的 fetch handler 解析回来。

```
https://<origin>/gatekeeper/project/p/<projectId>              project
https://<origin>/gatekeeper/project/f/<projectId>/<fileId>     文件字节
https://<origin>/gatekeeper/project/w/<projectId>/<widgetId>/  widget（前端）
https://<origin>/gatekeeper/project/w/<projectId>/<widgetId>/api/…  widget 的后端
```

`/gatekeeper/project` 这个前缀是 router 里 `GATEKEEPER_PROJECT` 这个 binding 名字定的，不是配置出
来的。

- **project 链接打开是一个说明页，什么都不透露。** HTTP 请求没有身份，回答不了"谁在问"，而一个写着
  project 名字的页面会把只有成员该知道的事告诉任何拿到链接的人。这个链接的用处是被 agent 认出来。
- **public 文件的链接是稳定的**，其它文件的链接**签了名并且会过期**（10 分钟）。签名的 key 不出
  `ProjectDurableObject`，签的内容包含 fileId 和过期时间，所以一个 token 只能证明"签它的时候，签的人
  确实能读这个文件"——既不能挪到别的文件上，也不能自己把有效期改长。
- **widget 的链接同理，但多两件事**：签的内容里除了 widgetId 和过期时间还有它是给哪个成员的，而且它每
  次被用到都会被拿去和当前状态重新对一遍。详见 [widget](#widgetproject-里的-mini-app)。widget 的地址
  以斜杠结尾——它是个目录，不是一篇文档。

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

## widget：project 里的 mini app

**widget 是一个成员发布到 project 里的小应用**：一个 `index.html` 加上它需要的静态文件。打开它的链接
就是在浏览器里跑它。只有 `index.html` 的 widget 就是一个完整的 widget，**存数据也不用写后端**——它自己
的 `api/store` 就是它的存储（见下面「[`api/`：不写后端也有一个 store](#api不写后端也有一个-store)」）。
想要真的跑自己的服务端逻辑，再写一个可选的 `backend.js`。

它不是官方的 Gadget。把人加进一个 gadget 等于共用一条 chat；widget 分享的是**应用**，不是 chat。它也
不是 skill——skill 是给 agent 读的说明书，widget 是给人点开的东西。一个 widget 可以**用** project 的
skill 和环境变量，但它自己不是 skill。

### 可见性就是分享开关

widget 用的是文件那三级可见性，一个字都没改：

```
private   只有 owner 能打开
project   project 的每个成员都能打开
public    任何能访问到这个 deployment、并且拿到链接的人都能打开
```

`public` 依然是字面意思——这个部署跑在 Cloudflare Access 后面，所以 public widget 仍然在 Access 的边
界内，**不是公网可见**。

规则和文件共用同一套函数（`model.ts` 里的 `defaultVisibility` / `visibilityAfterMove` / `canRead` /
`canWrite` / `canDelete`），不是抄一遍：

- **路径就是意图。** `shared/` 下面的 widget 默认 `project` 可见，别处默认 `private`。
- **`setWidgetVisibility()` 是显式的那个开关**，也是唯一的分享控制。
- **`moveWidget()` 同时改路径和可见性**，唯一的例外还是 `public`：发布过的 widget 改名之后还是 public。
- **只有 owner 能改自己的 widget**，project owner 也不行。删除是唯一的例外，project owner 可以删任何
  widget——需要有人能清场。

这里刻意没有发明第二套权限。一个已经知道"谁能读我的文件"的成员，不应该还得再学一遍"谁能打开我的
widget"。

### 地址

```
/gatekeeper/project/w/<projectId>/<widgetId>/…            前端文件
/gatekeeper/project/w/<projectId>/<widgetId>/api/store/…  内置的 store（没有 backend.js 时）
/gatekeeper/project/w/<projectId>/<widgetId>/api/…        自己写的后端（有 backend.js 时，整个 api/ 都归它）
```

widget 的地址**以斜杠结尾**，因为 widget 是个目录而不是一篇文档：`index.html` 里写 `app.js` 是相对当
前目录解析的，少了那个斜杠就会跑到 widget 外面去找。地址根部解析成 `index.html`；`api/` 前缀归后端，
所以 widget 里不允许存 `api/…` 这样的文件——那种文件的地址永远没人能访问到，不如在写的时候就拒绝。

`backend.js` 永远不会被当成静态文件发出去：那是模块源码，把它交出去等于把作者内联在里面的任何东西一起
发布了。

### CSP：和文件预览不一样，而且必须不一样

文件预览走的是 `default-src 'none'; sandbox`。对一篇没人指望它运行的文档这是对的，对一个应用这是致命
的——widget 不能跑自己的脚本就不成其为 widget。所以 widget 前端用的是另一条策略，说的是"给它哪些能
力"而不是"一个都不给"：

```
default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:; font-src 'self' data:;
connect-src 'self' <这个 widget 自己的 api/>;
base-uri 'none'; form-action 'none'; frame-ancestors 'self'
```

两条路由都保留 `x-content-type-options: nosniff`。**文件预览那条路由一点没动。**

`connect-src` 里点名了 widget 自己的后端，但里面同时还有 `'self'`，所以这里要把话说明白：**CSP 不是
widget 和这个部署之间的那道墙，同源从来都不是。** widget 是从部署自己的 origin 上发出去的，它用相对
URL 取自己的文件。真正让 widget 的伸手范围有限的是另外三样东西：路由、按路径限定的 cookie，以及它的
后端跑在一个除了给它的东西以外什么都没有的 isolate 里。

代价说清楚：**发布一个 widget，等于对它的作者给出接近浏览器扩展那种程度的信任**——前端代码是成员自己
写的，跑在部署的 origin 上。这也正是 `setWidgetBackend()` 从不进入自动批准名单的原因。

### 认证：signed capability + 按路径限定的 cookie

浏览器那一侧有 Access，但 Project 账号 id 是一个随机 UUID 而不是邮箱（`getAuthenticatedEmail()` 现在
返回 null），所以**不能把 Access 的邮箱当成一个成员**。这里没有发明 OAuth 流程，做法是文件 token 的
同一个思路：

1. **`getWidgetLink()` 签发一个 capability**，签的内容包含 widgetId、它是给哪个成员的、以及过期时间
   （10 分钟）。签名 key 不出 `ProjectDurableObject`。public widget 拿到的是**稳定链接**——里面没有
   任何会过期的东西。
2. **第一次命中就换成 cookie**：`HttpOnly`、`SameSite=Lax`、`Path` 限定到这一个 widget 的路径。这样
   SPA 自己的 fetch 不用在每个 URL 上挂 token，widget 的脚本也读不到它，浏览器也不会把它送到部署的
   任何别的地方去。
3. **每一个请求都重新判定**，前端和后端都一样：token 是不是真的、它指的成员现在还是不是成员、widget
   现在的可见性让不让他进。三个问题的答案都是**对当前状态实时回答的**，和 observer 校验是同一个思路。
   所以 owner 把 widget 改回 private，已经打开着它的浏览器立刻就被关在外面——那个 cookie 签名完好、
   也还没过期，变的是它背后的答案。
4. **每次答应都换一张新的 capability**（滑动续期）。这件事之所以安全，恰恰是因为每次都重判了：widget
   在被用着的时候一直开着，答案一变就立刻关上。

token 里带着 widgetId，所以一个 widget 的 cookie 拿到另一个 widget 上是无效的——两者是同一个 project
key 签的，payload 里的 widgetId 就是唯一把它们分开的东西。cookie 名字也按 widget 区分。

### `api/`：不写后端也有一个 store

一个只想记住点东西的 widget——一份清单、一个草稿、一个分数——以前必须写 `backend.js`。那意味着两件事：
账号上得有 Dynamic Worker Loaders，以及**每次改这个模块都要有人点头**（`project.widget-code` 明确不在
自动批准名单里，见下面）。这两个代价对"跑成员自己写的代码"来说是对的，对"一个下一个人打开还看得见的
localStorage"来说完全不对。

所以**没有 `backend.js` 的 widget，它的 `api/store` 由这个 Worker 自己回答**，后面接的就是那个本来会
交给后端的 `WidgetStoreDurableObject`：

```
GET    api/store?prefix=&limit=   → { entries: [{ key, value }] }
GET    api/store/<key>            → { key, value }，没有就是 404
PUT    api/store/<key>            ← 请求体原样存成 value
DELETE api/store/<key>            → 204，key 本来在不在都一样
```

前端就是这么用的，一行服务端代码都不用写：

```js
await fetch("api/store/draft", { method: "PUT", body: JSON.stringify(draft) });
const { value } = await (await fetch("api/store/draft")).json();
const { entries } = await (await fetch("api/store?prefix=note/")).json();
```

**value 就是请求体本身，没有信封。** 另一种设计是 `{ "value": "…" }`，它在 curl 例子里好看，在别的地
方都更糟：一个存 JSON 的 widget 得去猜自己那个对象有没有被拆开一层，而答案取决于一个它未必控制得了的
content-type。`PUT` 一个字符串，`GET` 回来同一个字符串。key 里可以带斜杠（`note/a`、`note%2Fa` 是同一
个 key），所以 widget 可以自己给 key 分命名空间。单个 value 上限 128 KiB，一个 widget 上限 1000 个 key。

要说清楚的几件事：

- **认证、CSP、cookie 续期和前端那条路一模一样**，不是另一套。每个请求都重新判定谁在问（下面「认证」那
  节说的三个问题），答案一变立刻关门。走的是同一个 `openWidgetApi()`。
- **public widget 的 store 就是 public 的。** 能打开这个 widget 的人就能读写它记住的东西——这和一个
  public 的后端本来会有的规则是同一条。`setWidgetVisibility()` 的审批描述里明说了这件事。
- **只有这一个 widget 自己的 store。** 不是 project 的文件，不是另一个 widget 的 store，也**不是
  project 的环境变量**。后端能读环境变量，是因为后端是成员写的、而且有人批过；这条路上没有任何人写过
  的代码，所以它一个值都不该交出去。`openWidgetApi()` 里那些值是**只在真的有模块要跑的时候才去读的**,
  没有模块时它们根本不会出现在返回值里。
- **`api/` 下面别的路径是 404**，而且那个 404 会写明这个 widget 只答 `api/store`。默默把 store 的列表
  返回给一个请求 `api/notes` 的 widget 更糟。
- **有 `backend.js` 的时候，整个 `api/` 都归它**，`api/store` 也一样。两样东西答同一个地址，等于这个路
  由的行为取决于一个调用方看不见的文件。后端通过 `env.STORE` 拿到的是同一个对象，所以加上或者删掉
  `backend.js`，存着的东西一个都不会丢。

### 后端能看见什么

`backend.js` 是一个普通的 Worker 模块（`export default { async fetch(request, env) { … } }`）。它不是
默认那条路，而是 widget 需要浏览器不能被信任的那种逻辑时才写的东西：一条"谁能改什么"的规则、一个从
project 环境变量里算出来的值、一个前端不能绕过的检查。

**跑法是真的 isolate**，不是 `eval`。模块是通过 `WIDGET_LOADER` 这个 Worker Loader binding 作为一个真
正的 Worker 加载起来的，`env` 由这个 Worker 亲手拼出来。**没有任何东西在这个 Worker 自己的作用域里被
求值**，所以 widget 写什么都碰不到这个 Worker 的 binding。没有用 Cloudflare Sandbox 或 Containers。

**这个 binding 是可选的。** Dynamic Worker Loaders 是账号级的功能，而一个 wrangler 建不出来的 binding
不是"少个功能"，是"deploy 直接失败"。所以 `packages/gatekeeper-project/wrangler.jsonc` 里**没有**
`worker_loaders`，要不要加由 `deployment.jsonc` 的 `project.widgetBackends` 决定（默认 `false`），
`scripts/deploy.ts` 据此往生成的配置里加。没有它的部署里，widget 的前端和 `api/store` 一切照旧，只有
带着 `backend.js` 的 widget 会拿到一个 **501**，而且那句话里写着少的是什么、还剩什么能用。

`env` 里就三类东西：

| 名字 | 是什么 |
| --- | --- |
| project 的环境变量 | **带值**，不只是名字。这是共享 skill 或 widget 能对所有人跑起来的前提 |
| `WIDGET` | `{ projectId, widgetId, principal }`，`principal` 是 `{ kind: "member", memberId, role }` 或 `{ kind: "public" }` |
| `STORE` | 只属于这一个 widget 的 KV，`get` / `put` / `delete` / `list`。一个 widget 一个 Durable Object，和 `api/store` 后面的是同一个 |

`WIDGET` 和 `STORE` 是保留名：project 要是刚好有同名的环境变量，它不会覆盖掉"谁在问"这个 binding。

**不在 `env` 里的东西**同样重要：没有 project 的 Durable Object，没有 R2 bucket，没有别的成员的
private 文件，没有浏览器那一侧的 Access token 或 cookie。principal 是一个 principal，不是一张凭证。

| 限制 | 值 | 为什么 |
| --- | --- | --- |
| `globalOutbound` | `null` | **后端默认到不了公网。** 这是运行时自己的开关，不是这里的一句承诺 |
| 超时 | 10 秒 | 挂住或者死循环的模块会被丢掉，等着的人拿到 502 |
| 请求体 | 1 MiB | 在启动 widget 的代码**之前**就在这里缓冲并卡住，不信调用方写的 header |
| 模块大小 | 128 KiB | widget 的后端是胶水，不是 bundle |

后端拿到的请求是**重新造过的**：调用方的 cookie 和 Access session 不是它的事，路由前缀也不该由它来
剥——它看到的是 `/api/…`，所以一个 widget 的后端不管是 private 还是已发布，读起来都一样。它的回答里
`set-cookie` 和它自己的安全 header 会被去掉：widget 设的 cookie 会是整个部署的 cookie。

isolate 按 widget × revision × 调用方缓存。revision 包含后端模块和 project 环境变量，所以改一个值就
会换一个新 isolate；调用方在 key 里，是因为 principal 在 `env` 里，而 loader 命中缓存时不会重跑那个
拼 `env` 的回调。

**一句要记住的话：** 后端能读 project 的环境变量，所以**把一个 widget 设成 public，等于把它的后端愿意
交出来的任何东西一起发布了**。`setWidgetVisibility()` 走的是 `project.share` 这个 action kind，描述里
会明说这件事。

### 写操作还是走那个审批队列

没有第二套东西。`createWidget` / `writeWidgetFile` / `setWidgetBackend` / `moveWidget` /
`setWidgetVisibility` / `deleteWidget` 全部走同一个 plan / commit 两段 + approval queue，`actions.ts`
里一条条列着怎么 apply、怎么 reject、怎么 revert。

action kind 分两个是故意的：

- `project.widget`——建一个 widget、写它的静态文件。和"写自己的文件"是同一种事，**在自动批准名单里**。
- `project.widget-code`——写 `backend.js`。这是**代码**，会带着 project 的环境变量跑、回答任何能打开这
  个 widget 的人，而且会接管本来在答 `api/store` 的那条内置路由。**明确不在自动批准名单里**，这是整个
  gatekeeper 里唯一一个人必须看一眼的写操作。

所以 `writeWidgetFile()` 会拒绝 `backend.js`，让你去用 `setWidgetBackend()`：不是为了多一个方法，而是
为了让人点头的那段描述里写着"这是代码"。

这个分界也是 `api/store` 存在的理由。存东西这件事现在落在**自动批准**的那一半里：写 `index.html` 是
`project.widget`，而那个 widget 从此就能记住东西了。**只有在 widget 真的要跑自己的代码时，才需要有人
点头**——而不是每次它想记住一份草稿的时候。

widget 的源文件没有做成普通的 project 文件（也就是说，它们不能被 comment、不能 `copyFile()`）。理由是
**可见性得有唯一一个说法**：widget 是可见性的单位，如果它的每个文件各有一个可见性，"谁能打开这个
widget"就会有两个互相矛盾的答案。想聊某个 widget 的做法，把想聊的东西作为普通文件写进 `shared/`。

### 配额

widget 的字节**算进 project 现有的配额**，和文件同一个额度：一个 widget 的 `index.html` 的字节和一篇
文档的字节花的是一样的钱，分成两个额度等于白送一份没人批准过的配额。文件数也一起算。

覆盖 widget 里的一个文件同样只按差额计费。

widget **store 里的东西不算在这个额度里**，它有自己的一套上限（单个 value 128 KiB、一个 widget 1000
个 key）。理由是它落在别的地方：文件字节在 R2，按 project 记总数；store 在每个 widget 自己的 Durable
Object 里，那个上限就在 `widget-store.ts` 里写着。

## 配额（付费点）

| 变量 | 默认 | 管什么 |
| --- | --- | --- |
| `PROJECT_MAX_FILE_BYTES` | 10 MiB | 单个文件，widget 里的文件也算 |
| `PROJECT_MAX_TOTAL_BYTES` | 1 GiB | 一个 project 的总字节，文件 + widget |
| `PROJECT_MAX_FILE_COUNT` | 2000 | 一个 project 的文件数，文件 + widget |

在 `deployment.jsonc` 的 `project.limits` 里改。这是部署级的决定，也是花钱的那一维：字节记在这个部署
自己的 R2 bucket 上。

覆盖一个文件只按差额计费，所以把一个已经顶到上限的文件重写一遍不会因为"装不下"被拒。

## 部署

```jsonc
"workers": { "project": { "name": "<PROJECT_WORKER_NAME>" } },
"project": {
  "sharingDomain": null,          // null 用公开 origin
  "filesBucket": null,            // null 让 wrangler 自动开一个
  "widgetBackends": false,        // true 才加 WIDGET_LOADER，需要账号有 Dynamic Worker Loaders
  "limits": { /* 见上表 */ }
}
```

`widgetBackends` 默认 `false`，而 `false` 是一个**完整**的部署而不是残缺的那个：widget 照样发前端、照样
通过 `api/store` 存数据。它 `true` 的时候多出来的是"跑成员自己写的 `backend.js`"，代价是账号上得有
[Dynamic Worker Loaders](https://developers.cloudflare.com/workers/runtime-apis/bindings/worker-loader/)。
没有那个访问权限却把它打开，结果是 deploy 直接失败，而不是 widget 悄悄不对劲。

**明确不需要 Workers for Platforms。** 内置的 store 就是这个 Worker 自己回答的一条路由。

`sharingDomain` 隔离的是"哪些 project 属于这个部署"，和 `context.sharingDomain` 是同一种东西。**改
它的唯一后果是安静的**：现有的 project 一个都不会消失，但一个都看不见了。如果这个部署的公开 origin
可能搬家，就把它显式写死。

它出现在两个地方，必须一致：Workshop 那条 binding 上的 prop（决定一次 session 在哪个域里工作），和这
个 Worker 自己的 `PROJECT_SHARING_DOMAIN`（决定它的 fetch handler 在哪个域里解析一个文件链接）。
`scripts/deploy.test.ts` 会检查两边相等。

## 还没做的

- **官方 Gadget 那条路**：widget 是这一层自己的东西，不是官方 Gadget。分享一个 gadget 会分享 chat，
  这正是这个 fork 存在的原因，所以 widget 明确不往那边靠。
- **widget 的界面挂载点**：widget 只有一个自己的地址，没有左侧导航项，也没有嵌进右侧功能区。要嵌进去
  得改官方 UI，那是核心 fork（`Yrzhe/cloudflare-os` 的 `multiplayer`）那条线的事。
- **widget 出网**：后端的 `globalOutbound` 是 `null`。要放开就得有一层能按域名收口的东西，在那之前
  默认就是到不了公网——需要外部服务的 widget 让它的前端去调，那里适用部署自己的策略。
- **widget 的源文件当普通文件**：widget 的文件不能被 comment、也不能 `copyFile()`。可见性得有唯一一个
  说法，而 widget 就是那个单位。想聊，把要聊的东西作为普通文件写进 `shared/`。
- **widget 的隔离到"另一个 origin"那种程度**：前端和这个部署同源，所以 CSP 划不出那道墙。真要划得给
  widget 一个自己的 origin，那是部署形状的改动。
- **实时协同编辑**：明确不做。这一层是 view → comment。官方自己在 gadget 代码上做实时编辑（先是 Yjs，
  从 `1ef6020` 起换成 git 存储 + OT），文档没有走这条路。
- **文件的 git 语义**：`moveFile()` / `copyFile()` 之外没有历史和分支。widget 也一样：
  `setWidgetBackend()` 覆盖一次，上一版就没了。
- **view → issue**：没做。
- **URL 寻址的资源**：只提供一个单例的 `ProjectDirectory` binding，agent 通过 `listProjects()` 和
  `openProject()` 进去。做 URL 寻址要连带做 configurator UI，不值得。
- **上传后的处理**：文件按原样存。PDF 之类只能做页级 comment，因为没有抽出文本。
