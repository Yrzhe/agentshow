# Lane C —— 前端 / 用户可见面 / 错误 UX

审的 commit：`cd21614`（detached，只读）。
**实测环境**：`npx vite dev --port 5298` 起真服务，`node scripts/seed.ts` 灌了 3 个 agent + `pricing` 项目，
另建了 `sea-saas` 项目和一个超长名字的 agent 做边界数据，跑了 4 轮真模型（Workers AI，
`@cf/moonshotai/kimi-k2.7-code`），真产出了 `pricing-table.tsx`（150 行，v1→v2）、
4 条评论、11 条活动、2 条 session。Playwright 打真页面驱动。
`npx tsc --noEmit` 零错误。审完已 `pkill` dev、删掉 `node_modules` / `.wrangler` /
`worker-configuration.d.ts` / 截图，`git status` 为空。

下面每条都带实测数字。凡是没能实测的，正文里明写「未实测」。

---

## [BLOCKER] 任何一次失败的轮询会把整个应用永久换成一行英文报错，成功的轮询也救不回来

**证据**：源 `agentshow/src/client.tsx:19`（`throw new Error(\`${path} → ${res.status}\`)`）
↔ `agentshow/src/client.tsx:49`（`.catch((e) => setError(String(e)))`）
↔ 目标 `agentshow/src/client.tsx:70`（`if (error) return <Center>{error}</Center>`）。
`grep -rn "setError" src/client.tsx` 只有 34/42/49 三处 —— **全文件没有一次 `setError(null)`**，
error 一旦置上就再也回不去。

**失败场景**（三次都是实测，不是推演）：

| 注入 | 屏幕上出现的字 | 之后 |
|---|---|---|
| 一次 HTTP 500 | `Error: /api/projects/pricing → 500` | 等 14 秒、3 次成功轮询，**不恢复** |
| 一次 `TypeError`（模拟断网） | `TypeError: Failed to fetch` | 同上，**不恢复** |
| 持续 500 | 同第一条 | 5 次失败，页面一直是这行字 |

`client.tsx:64-68` 那个 4 秒定时器每 4 秒就掷一次骰子。演示时 agent 正在跑推理、
DO 冷启、Wi-Fi 抖一下 —— 任何一次命中，整块界面（左中右三栏全没了）就变成
一行 12px 灰字的英文异常，**只有手动刷新浏览器能出来**。而刷新又会丢掉当前位置（见下面那条）。

这条同时踩了 brief 的两个判据：「一个不懂技术的人看得懂吗」和「英文报错就是 bug」。
`String(e)` 把 `Error: `前缀、内部路由路径和 HTTP 状态码一起端给了用户。

**建议**：轮询失败不该有资格接管整个应用。分两级 —— 首次 `/api/me` 失败才算致命；
轮询失败只在角落挂一条「连接不上，正在重试」，并且 `reload` 成功时 `setError(null)`。
文案给人话（「暂时连不上服务器」），不要 `String(e)`。

---

## [HIGH] 切 project 时在途的旧请求会把上一个 project 的数据画到新 project 上，最长 4 秒

**证据**：源 `agentshow/src/client.tsx:45-50`（`reload` 里 `.then(setProject)` 没有任何
取消或「这个响应还属不属于当前 projectId」的校验）
↔ 目标 `agentshow/src/ProjectPanel.tsx:110` + `agentshow/src/ui/FileDetail.tsx:267-268`
（详情和评论 POST 都用 `project.projectId`，即那份**数据自带的** id，不是当前选中的 id）。

**失败场景**（实测时间线，把 `pricing` 的响应延迟 5 秒，然后点 `sea-saas`）：

```
16.18  REQ pricing（4 秒轮询发出）
16.18  用户点了 SEA SaaS 调研
16.39  界面正确切到 SEA SaaS（成员只有 Verdigris）
21.23  ← 迟到的 pricing 响应落地，中栏标题变回「定价页改版」，
        右栏成员变回 Ferrule / Verdigris / Sable / 一个名字非常非常长的…
24.25  下一次 sea-saas 轮询才纠正回来
```

**这 3 秒里界面自相矛盾**：左栏高亮 SEA SaaS，中栏标题写「定价页改版」。
更要命的是它不只是画错 —— 这段时间文件列表是旧 project 的，用户点进去
就是 `GET /api/projects/pricing/file`，在里面留的评论会 `POST /api/projects/pricing/comments`
（`FileDetail.tsx:268`）。**用户以为自己在 B 项目里说话，字落进了 A 项目。**

顺带：`client.tsx:36-43` 的 `/api/me` 那次请求同理无守卫，只是它只跑一次。

**建议**：`reload` 里带上发起时的 `projectId`，`.then` 里比一次再 `setProject`；
或者给 fetch 挂 `AbortController`，effect 清理时 abort。两行的事。

---

## [HIGH] 对话里直接铺开 agent 的英文思维链和内部工具名 —— 这是演示时同事看到的第一屏

**证据**：源 `agentshow/src/server.ts:46`（模型是 `@cf/moonshotai/kimi-k2.7-code`，
它的 reasoning 大量出英文）↔ 目标 `agentshow/src/ui/Chat.tsx:105-111`
（`part.type === "reasoning"` 分支把 `part.text` 原样铺出来，没有标签、没有折叠、没有「思考过程」字样）
↔ `agentshow/src/ui/Chat.tsx:113-119`（`tool-` 分支把工具名去掉前缀后**原样**用等宽字显示）。

**实测原文**（对 Ferrule 说「写一个 pricing-table.tsx 到公共区」，屏幕上出现的第一段字，
挂在「Ferrule」这个名字底下，看起来就是 Ferrule 说的话）：

```
Ferrule
The user wants me to write a pricing-table.tsx file to the project public area.
Requirements: - Three pricing tiers - At least 30 lines - Must use project public
file tools (readProjectFile/writeProjectFile) I need to first read the file to get
version, but if it doesn't exist, baseVersion should be 0. Let me first check if the
file exists using readProjectFile.
→ readProjectFile
```

三件事同时发生：整段英文、内部工具名 `readProjectFile` 两次、
「project public area」这种实现黑话。设计稿的赌注是「agent 是同事」，
而同事不会用英文自言自语再报一遍自己要调哪个函数。

同一屏还有第三个泄漏：**markdown 不渲染**。`Chat.tsx:97-102` 用
`whitespace-pre-wrap` 纯文本渲染，实测 Ferrule 的收尾发言是

```
已写入公共区 `pricing-table.tsx`，version 1，共 128 行。
```

反引号原样露在外面，`version` 是英文。模型写列表、代码块、加粗时都会这样。

**建议**：三件事分开做。(1) reasoning 默认折叠，给一个「思考过程」的中文抬头，
展开才显示；(2) 工具名过一张中文映射表（`readProjectFile` → 「读了公共区的文件」），
映射不到再退回原名；(3) 文本走一个最小 markdown 渲染（至少 inline code / 代码块 / 列表）。
(1) 和 (2) 是 demo 必须的，(3) 可以后一步。

---

## [HIGH] 对话完全不处理连接与推理失败，且发送失败时把用户刚打的字清掉

**证据**：源 `agentshow/src/ui/Chat.tsx:32` —— `const { messages, sendMessage, status } = useAgentChat({ agent })`，
只取了三个字段。而这个 hook 的返回类型里明确有别的东西：

- `node_modules/@cloudflare/think/dist/react.d.ts:54-60` → `connectionError: (Error & { code, reason, wasClean }) | null`
- 同上 `:50-52` → `isServerStreaming` / `isStreaming` / `isRecovering`
- `node_modules/@ai-sdk/react/dist/index.d.ts:113-114` → `error: Error | undefined`，以及 `clearError` / `regenerate` / `stop`

目标 `agentshow/src/ui/Chat.tsx:57` 只判了一个分支：`status === "streaming"` 显示「思考中」。
`status` 的取值里还有 `"error"`，代码里**一次都没出现**（`grep -n '"error"' src/ui/Chat.tsx` 无命中）。

**失败场景**：WebSocket 掉线（合盖、切网、Worker 重新部署）之后，界面表现和「agent 还在想」
一模一样：「思考中」消失，什么都不再来，没有横幅、没有重连提示、没有重试按钮。
用户接着打第二句 —— `agentshow/src/ui/Chat.tsx:128-133` 的 `send()` 里
`if (ref.current) ref.current.value = ""` 是**无条件**执行的，
`onSend` 有没有真的送出去它不看。于是输入框清空、消息没发出去、屏幕上没有任何痕迹。

**未实测**：我没能构造出真实的模型失败或 WS 断连（本地 dev 下不好稳定复现），
上面是按类型定义和代码分支读出来的。但「只解构了三个字段、只判了一个 status 分支、
清空是无条件的」这三点都是文件里可以直接核对的事实。

**建议**：把 `connectionError` 和 `error` 接出来渲染一条中文条幅 + 重试；
`send()` 改成只有在 `sendMessage` 没抛的情况下才清空 textarea。

---

## [MED] 文件详情一次读失败就永久卡死，而且错误屏把唯一的返回入口也吃掉了

**证据**：源 `agentshow/src/ui/FileDetail.tsx:51`（`throw new Error(\`${url} → ${res.status}\`)`，
url 里带完整查询串）↔ `:54`（`setError(String(e))`）↔ 目标 `:85`（`if (error) return <Pad>{error}</Pad>`）。
同样**没有任何 `setError(null)`**。而且 `:60-67` 的 effect 只在 `path` 或 `stamp` 变化时才重取 ——
文件没被动过，stamp 就不变，连一次自动重试都不会有。

**实测**：注入一次 500，屏幕上出现

```
Error: /api/projects/pricing/file?path=pricing-table.tsx → 500
```

等 9 秒（两轮以上轮询）**原样不动**。此时右栏上剩下的按钮只有四个 tab
（实测 `["", "概览", "文件", "活动", "成员"]`）—— `:91-105` 那个「文件 / 共享区」
面包屑返回入口在 `:85` 的早退之前就被跳过了。用户唯一的出路是发现「点上面的 tab
可以出去」，而屏幕上没有任何东西这么提示。

**建议**：错误分支画在面包屑**之下**而不是替换整屏；给一句中文（「这个文件暂时读不到」）
加一个「重试」；`load()` 成功时清 error。

---

## [MED] 点评论跳行会把目标行滚出视野 —— `offsetTop` 的参照系不是代码框

**证据**：源 `agentshow/src/ui/FileDetail.tsx:76`
（`box.scrollTop = line.offsetTop - box.clientHeight / 2`，把 `offsetTop` 当成「行在框内的位置」）
↔ 目标 `agentshow/src/ui/FileDetail.tsx:139`
（代码框的 class 是 `rounded-lg border ... overflow-auto max-h-72 py-2` —— **没有 `relative`**）。
`overflow: auto` 不会让元素成为 `offsetParent`，只有 `position != static` 才会。
所以 `line.offsetTop` 量的是「到 `<body>` 的距离」，里面白白包含了面包屑、标题块、
tab 条那一截高度。

**实测**（150 行的 `pricing-table.tsx`，评论 anchor 是「第 4 行」）：

```
offsetParent            = BODY          ← 不是代码框
line4.offsetTop         = 223
第 4 行在框内的真实位置  = 63            ← 差了 160px
box.clientHeight        = 286
=> 代码算出 scrollTop    = 223 - 143 = 80
```

点下那条评论之后实测：`scrollTop = 80`，**第 4 行的顶边落在框顶上方 -17px，
`line4_isVisible = false`**，框里可见的是第 5–20 行。高亮底色确实打在第 4 行上 —— 
但那一行被滚出去了，用户看到的是一片没有高亮的代码。

正确值应该是 `max(0, 63 - 143) = 0`（第 4 行本来就在第一屏，根本不用滚）。
文件越长错得越离谱：这个偏移是固定的 ~160px，约等于 9 行。

`FileDetail.tsx:69-70` 的注释说得很清楚是为了「点一条评论要能看见它说的是哪一行」——
这条恰好让那个目的失效，而且是**安静地**失效：没报错，只是滚到了别处。

**建议**：给 `:137-140` 那个框加 `relative`（一个 class），或者改用
`line.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop`。

---

## [MED] 活动流头部的条数和列表里能数出来的行数对不上，最多差一倍

**证据**：源 `agentshow/src/ui/ActivityTab.tsx:43`（`{rows.length} 条` —— 折叠**前**）
↔ 目标 `agentshow/src/ui/ActivityTab.tsx:63`（`groupByDay(collapseActivity(rows), t)` —— 渲染的是折叠**后**）。

**实测**（同一屏，只切筛选）：

| 筛选 | 头部写 | 实际渲染的行数 |
|---|---|---|
| 全部 | 11 条 | 9 |
| 评论 | 4 条 | 2 |

「评论」那一栏最糟：头上写「4 条」，底下两行，而**每一行自己还写着「留了 2 条」**。
一个不懂技术的人对着这屏没法确定到底有几条。

对照 `agentshow/src/ui/OverviewTab.tsx:30-35`：同样是 `SectionHeader` 加一个数字，
成员那个 count 和行数是严格相等的（实测 5 / 5）。**同一个视觉模式在两处是两套语义**，
而界面上没有任何东西区分它们。

**建议**：要么头部改成折叠后的组数，要么在折叠行上把「代表 N 条」讲明白到头部
（例如「9 组 · 11 条」）。别让两个数字都只是裸数字。

---

## [MED] 成员行可以 Tab 聚焦，但键盘按下去什么都不会发生

**证据**：源 `agentshow/src/ui/rows.tsx:66-68`

```
role={clickable ? "button" : undefined}
tabIndex={clickable ? 0 : undefined}
onClick={clickable ? () => onOpen(m.memberId) : undefined}
```

`role="button"` + `tabIndex={0}` 承诺了「这是个按钮」，但整个组件里没有 `onKeyDown`
（`grep -n "onKeyDown" src/ui/rows.tsx` 无命中）。

**实测**（成员 tab，聚焦 Ferrule 那一行）：

```
{ role: "button", tabindex: "0", hasOnKeyDown: false, tag: "DIV" }
focused: true
按 Enter → 身份卡没打开
按 Space → 身份卡没打开
```

影响：这一屏上每个 agent 成员都是一个 Tab 停靠点（实测这个项目有 4 个），
键盘用户会挨个停过去，**每一个都是死的** —— 而鼠标用户点同一行会打开身份卡。
辅助技术上报的是「按钮」，行为上不是。

**建议**：这一行没有嵌套交互元素（实测全页 `button button` = 0），
直接换成 `<button type="button">` 最省事，`role`/`tabIndex` 都能删掉。
真要留 div 就补 `onKeyDown`（Enter / Space，Space 要 `preventDefault`）。

---

## [MED] 三个画了但不接任何东西的图标控件，NOTES 里没有记

NOTES `2026-08-31T06:27:35`（「三个写端点从 Task 10 提前到 Task 8」）豁免的是
「新对话」「我的 Agent」「管理」「+」。这四个不算发现。但下面三个不在那张单子上，
而且它们**不依赖任何后端**，纯是前端控件：

| 位置 | 画的是什么 | 点了 |
|---|---|---|
| `agentshow/src/ui/Sidebar.tsx:40` | `<PanelIcon />` 侧栏折叠图标 | 无 `onClick`，裸渲染 |
| `agentshow/src/ui/Sidebar.tsx:102` | `<ChevronUpDownIcon />` 账号切换角标 | 同上 |
| `agentshow/src/ui/SessionList.tsx:41` | `<ListIcon />` 列表视图切换 | 同上 |

三个都是产品里最容易被顺手点的位置（侧栏折叠、头像旁的上下箭头）。
按 NOTES 自己定的规矩 ——「点不动的按钮比没有按钮更糟」（`2026-08-31T07:24:33` 那条）——
这三个应该按同一条筛掉，或者接上（前两个纯客户端就能做）。

顺带一个 NOTES 已经过时的地方：那条说「管理」不可点，但
`agentshow/src/ui/OverviewTab.tsx:33-34` 现在把它接到了 `onSeeAll("成员")`，实测能跳。

---

## [MED] 刷新一次就回到起点：整个应用没有任何 URL 状态

**证据**：`grep -rn "location\|history\|pushState\|hash\|searchParams" src/client.tsx src/ui/`
→ **零命中**。源 `agentshow/src/client.tsx:40`（`setProjectId((cur) => cur ?? m.projects[0]?.projectId ?? null)`
—— 永远回落到第一个项目）↔ `agentshow/src/client.tsx:30`（`open` 初值 `null`）
↔ `agentshow/src/ui/ProjectPanel.tsx:63`（tab 初值「概览」）。

**失败场景**：agent 正在跑，用户手抖 ⌘R（或者被 BLOCKER 那条逼着刷新）——
回来落在 `me.projects[0]`、会话列表、概览 tab。他刚才在看的第二个项目、
刚才开着的那条对话、刚才打开的文件详情，全丢。地址栏从头到尾是 `http://localhost:5298/`，
所以也没法把「Verdigris 的这条 session」发给同事看。

推理还在跑不受影响（消息住在 AgentDO 里），丢的纯是位置。但演示时这是明显的一顿。

**建议**：把 `projectId` / `open.agentId` / `detail` 落到 hash 或 query 上，
初始化时读回来。三个 `useState` 的事。

---

## [LOW] 图标按钮没有可访问名

**证据**：`agentshow/src/ui/Chat.tsx:50`（返回）、`:151`（发送）、
`agentshow/src/ui/ProjectPanel.tsx:77`（回概览）、
`agentshow/src/ui/FileDetail.tsx:334`（发送）、`agentshow/src/ui/SessionList.tsx:146`（发送）——
都是 `<button>` 里只放一个内联 svg，没有 `aria-label` 也没有 `title`。
`agentshow/src/ui/icons.tsx:13-23` 的 `svg()` 也没给 `aria-hidden`。

**实测**（对话屏）：14 个 button 里 3 个没有任何可访问名；12 个 svg 全部没有 `aria-hidden`。

**建议**：三个动作按钮加 `aria-label`（返回 / 发送 / 回到概览），
`icons.tsx:14-19` 那个 `<svg>` 统一加 `aria-hidden="true"`（它们全是装饰）。

---

## [LOW] 「5 人 · 其中 4 个 agent」—— 把 agent 数进「人」里

**证据**：`agentshow/src/ui/MembersTab.tsx:16`（`const agents = ...filter(kind === "agent").length`）
↔ `:24-26`（`{project.members.length} 人 · 其中 {agents} 个 agent`）。

**实测**：这个项目 1 个人 + 4 个 agent，界面上写的是「**5 人 · 其中 4 个 agent**」。
给同事演示时这句话是自打脸的：先说有 5 个人，紧接着说其中 4 个不是人。
量词跟着 `members.length` 走，而这张表本来就是刻意混装的。

**建议**：换成不带量词的「5 位成员 · 4 个 agent」，或者「1 人 + 4 个 agent」。
后者顺带把「混排」这件事说出来了。

---

## [LOW] 文案的三处不一致

1. **空态句号**：`agentshow/src/ui/OverviewTab.tsx:81`「还没有动静」（无句号）
   ↔ `agentshow/src/ui/ActivityTab.tsx:89`「这个分类下还没有动静。」（有句号）。
   同一句话在相隔一次点击的两屏上两种收尾。（其余空态里
   `Sidebar.tsx:70/87`、`OverviewTab.tsx:60` 无句号，`FileDetail.tsx:214`、
   `AgentCard.tsx:126`、`FilesTab.tsx:71`、`SessionList.tsx:86` 有句号。）

2. **「agent」三种写法，全在左栏一列里**：`Sidebar.tsx:45`「我的 **A**gent」、
   `:73` 分区标题「**AGENT**」、`:87`「还没有 **a**gent」、`:99`「N 个 **a**gent」。
   同时 `:48` 的分区标题是中文「项目」而 `:73` 是英文全大写 —— 两个并列的分区标题不同语言。

3. **`updated` 把版本号硬塞进主句**：`agentshow/src/ui/format.ts:117-121`
   拼出的是 `${who} 写入 ${what} ${row.detail}`，实测渲染为
   「**Sable 写入 pricing-table.tsx v2**」—— 一个裸的 `v2` 结在句尾，没有分隔。
   对照同文件 `:124-129`，`rejected` 走的是 `versionClash()`，
   出来的是「手上是 v1，公共区已经是 v2」这样的中文副句。同一列里两种待遇。

---

## [LOW] 折叠行的副句只显示其中一条评论的 anchor

**证据**：源 `agentshow/src/ui/format.ts:194-208`（`collapseActivity` 保留组里**第一条**
的 `row`，只累加 `count`）↔ 目标 `agentshow/src/ui/format.ts:131-139`
（`commented` 分支 `detail: row.detail ?? undefined`，用的就是那一条的 anchor）。

**实测**：Verdigris 的两条评论 anchor 分别是「第 43 行」和「第 4 行」，
折叠后那一行显示的是「Verdigris 复审了 pricing-table.tsx，留了 2 条 / **第 43 行** · 刚刚」——
读起来像「这 2 条都是关于第 43 行的」。

**建议**：折叠时把 detail 丢掉（副句只留时间），或者写成「第 43 行等 2 处」。

---

## [LOW] @ 完一个 agent 之后，界面上没有任何「已经叫醒它了」的回执

**证据**：`agentshow/src/ui/FileDetail.tsx:223-228` —— 成功分支只做了三件事：
清 anchor、`load()`、`onChanged()`。而 `load()` 重取的是**评论**，
@提及不是评论，讨论区不会多出一行；失败才有字（`:283`）。

**实测**：在文件详情里选中 @Verdigris 发出去，输入框清空，
`:349-353` 那句「这会叫醒它，它会自己读 … 再决定怎么做」也跟着 `to` 被清掉而消失 ——
整屏没有任何变化。要确认发出去了，得自己切到「活动」tab 才看得到
「dev 提及了 Verdigris，在 pricing-table.tsx」（实测确实在那里）。

`:282` 的注释写着「静默失败在这里最伤：用户以为已经把活派出去了」——
成功路径现在也是静默的，只是结果相反。

**建议**：成功后在讨论区上方留一条一次性的中文提示（「已经把这件事交给 Verdigris 了」），
或者干脆让提及也在讨论线程里留一条系统行。

---

## [LOW] 代码块每行一个 `<button>`，没有虚拟化

**证据**：`agentshow/src/ui/FileDetail.tsx:141-162` —— `lines.map` 每行产出一个
`<button>` 套两个 `<span>`，外面是 `max-h-72`（288px）的滚动框（`:139`）。

**实测**：150 行的文件 → 框里 **150 个 button**，整页 643 个 DOM 节点。
可见区只放得下约 16 行，其余 134 行全是白渲染。线性外推：
1000 行 ≈ 1000 个 button / 4000 节点，5000 行 ≈ 5000 个 button。
而且 `:60-67` 的 effect 在每次 stamp 变化（= 每次有 agent 写这个文件）时会整个重取重渲。

**未实测**：我没有造出 5000 行的文件（`writeProjectFile` 的 `content` 在
`agentshow/src/agent-tools.ts:73-77` 上**没有长度上限**，所以模型理论上写得出来）。
150 行这一档完全不卡，这条是关于伸缩性的判断，不是「现在就坏」。

**建议**：演示体量下不用动。真要防，最省事的是超过 N 行时只渲染前 N 行
加一句「文件太长，只显示前 N 行」——比引虚拟列表便宜得多。

---

## 我检查了但没发现问题的（列出来是为了让上面那张单子的边界清楚）

- **`<button>` 嵌套 `<button>`**：实测全页 `button button` = 0，`button [role=button]` = 0。干净。
- **控制台**：整轮操作（4 次真模型对话、开关文件详情、切 tab、切 project）
  0 error 0 warning（Playwright `browser_console_messages` 实测）。
- **`npx tsc --noEmit`**：0 错误。
- **`firstPrompt` 的重发防护**（`Chat.tsx:34-40`）：`sent` 是 `useRef`，
  同一个组件实例上双调用 effect 时值会保留，所以 StrictMode 下也成立；
  而且 `client.tsx:131` 是裸 `createRoot(...).render(<App />)`，**根本没开 StrictMode**。
  `sendMessage` 身份变化会让 effect 重跑，但同样被 ref 挡住。这条不是问题。
- **`stamp` 机制**（`ProjectPanel.tsx:35-38`）：我按当前数据模型逐条找过漏掉的变更类型 ——
  没找到。`version` 单调递增覆盖了一切内容变化，`comments` 覆盖了讨论变化，
  owner 不会变（`project.ts:80-95` UPDATE 不碰 `owner_id`），评论没有编辑和删除。
  **这条我判定为无发现**，不是没查。
- **截断**：文件路径（`rows.tsx:119`）、活动主句（`rows.tsx:184`）、tagline（`rows.tsx:77`）、
  session 标题（`SessionList.tsx:68`）都带 `truncate` + `min-w-0`，实测不溢出。
  身份文档那个框（`AgentCard.tsx:103`）虽然没写 `overflow-x-auto`，
  但实测 `overflow-wrap: anywhere` 生效，长串会断行，`scrollWidth === clientWidth`。不是问题。
- **超长成员名**：`rows.tsx:74-76` 那个名字 span 是 `shrink-0` 且**没有** `truncate`，
  理论上够长就会把右边的 `AGENT` 标记挤出去。但我用 24 个汉字的名字在 1280px 下实测
  （面板宽 519px）**没有溢出**（`scrollWidth === clientWidth === 519`）。
  schema 允许到 40 字（`api.ts:39`），按 12px 字号算 40 字才会越界。
  **没复现出来的就不算发现**，只记在这里供参考。

---

## 判决

**FIX-FIRST。**

拦路的是两条，都不是「不好看」而是「演示会当场断」：

1. **BLOCKER 那条**——4 秒一次的轮询，任何一次失败就把整个应用永久换成一行英文异常，
   成功的轮询救不回来，只能手动刷新；而刷新又会丢掉当前位置（MED 那条）。
   演示时 agent 正在跑、DO 冷启、网络抖一下都可能命中。
2. **英文思维链那条**——对话页是演示的主屏，而屏幕上第一段字是英文自言自语加内部函数名。
   brief 说得很直接：「UI 上出现实现黑话、内部 id、英文报错，就是 bug」。

第二梯队是切 project 的竞态（会把评论写进错的 project）和文件详情两条
（一次失败永久卡死 + 点评论跳错行）。这四条都是几行到十几行的改动，不动架构。

### 我没能覆盖的

- **像素与设计稿的一致性**。brief 说了不猜像素，我也确实没看过 Paper 稿，
  这一栏我一个字都没审。
- **真实的模型失败 / WS 断连的界面表现**。HIGH 第 4 条是读类型定义和分支读出来的，
  不是实测出来的 —— 我没能在本地稳定构造出一次真的推理失败。
- **窄屏与移动端**。全程只在 1280×800 单一尺寸下看。左栏 240 + 中栏 520 是写死的
  （`Sidebar.tsx:30` `w-60`、`Chat.tsx:48`/`SessionList.tsx:36` `w-130`），
  窄到 900px 以下右栏还剩多少、会不会横向滚，我没测。
- **深色模式**。`styles.css` 我没有逐行读，也没有切系统主题验证。
- **`npx vitest run`**。跑了 `tsc --noEmit`（0 错误），但没跑测试套件 ——
  界面本来就没有自动化测试（spec §7 明写不写），跑它对这一栏没有增量信息，
  而它属于别的 lane 的判据。
- **一次我怀疑但没坐实的现象**：从会话列表输入框开新对话时，
  有两次采样看到「用户自己那条消息在第一轮期间不显示」（4s 和 ~20s 两个时点各一次），
  但我做连续采样复验时**没有复现**（用户消息 501ms 就出现了）。
  按默认 confirmed=false，这条不写进上面的清单。如果别的 lane 撞见同样现象，
  线索在 `Chat.tsx:34-40` 挂载即发的那个 effect 和 `useAgentChat` 的乐观更新时机上。

### 一条越界的提醒（不算我的发现，交给 A/B lane 判）

`agentshow/src/server.ts:202` 的 `routeAgentRequest(request, env)` 只在
`verifyAccess` 之后，**没有任何「这个 agent×project 归不归调用者」的检查**。
而 `handleApi` 里每条 project 路由都查了归属（`api.ts:234-235`）。
这两条路的把关强度不一致 —— 是不是问题该由 lane A/B 定，我只是路过看到。
