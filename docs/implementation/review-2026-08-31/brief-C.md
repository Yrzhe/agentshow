# Lane C —— 前端、用户可见面、错误 UX

先读 /tmp/agentshow-review/CONTEXT.md（共享上下文 + 硬性要求 + 交付格式）。
worktree：/tmp/agentshow-review/wt-C     输出：/tmp/agentshow-review/out-C.md    代号：C

## 你的攻击面

界面代码全在 `agentshow/src/ui/` 和 `agentshow/src/client.tsx`。
设计基准是 Paper 上的稿（你看不到，别去猜像素）—— 你审的是**行为和用户可读性**，不是像素。

**这一栏最重要的判据是「一个不懂技术的人看得懂吗」。**
这个产品要给同事演示，UI 上出现实现黑话、内部 id、英文报错，就是 bug。

具体查这些（不限于）：

1. **实现细节泄漏到界面** —— 逐个用户可见字符串过一遍：
   有没有出现 agent id（`ferrule`）而不是名字（`Ferrule`）？邮箱全文？
   DO 实例名？`stale`、`baseVersion`、`v1→v2` 这种内部表示？
   `src/ui/format.ts` 是所有「数据变成字」的地方，重点看。
   `src/ui/Avatar.tsx` 在拿不到成员时用 id 首字母兜底 —— 那会显示成什么？

2. **错误 UX** —— `src/client.tsx` 的 `api()` 抛错后整个应用显示什么？
   `setError(String(e))` 会把什么呈现给用户？（提示：`Error: /api/me → 500`）
   `FileDetail` / `AgentCard` 的加载失败分支呢？
   `SessionList` 和 `FileDetail` 的 Composer 发送失败呢？
   **网络断了、agent 正在跑的时候刷新页面、project 被切走**这三种情况分别怎么表现？

3. **React 正确性** ——
   `client.tsx` 里 4 秒轮询的 `useEffect`：切 project 时旧的定时器和**在途请求**怎么办？
   一个慢响应回来时 project 已经切了，`setProject` 会不会把旧 project 的数据画到新 project 上？
   （这是竞态，请给出具体的时序）
   `Chat.tsx` 的 `firstPrompt` 用 ref 防重发，React 18 StrictMode 双调用下成立吗？
   `useAgentChat` 的 `sendMessage` 身份变化会不会让那个 effect 重跑？
   `FileDetail` 的 `stamp` 机制（外层快照的「版本:评论数」指纹）有没有漏掉的变更类型？

4. **空态与边界数据** —— 逐个组件想：
   0 个 project / 0 个 agent / 0 个成员 / 0 个文件 / 0 条活动 / 0 条评论 分别显示什么？
   超长文件路径、超长 agent 名、超长评论、1000 行的文件、100 条活动？
   `FileDetail` 的代码块 `max-h-72`，一个 5000 行的文件渲染 5000 个 button 会怎样？

5. **可访问性与语义** —— 大量交互用 `<button>` 包了整行，`rows.tsx` 的 `MemberRow`
   用了 `role="button"` + `onClick` 但**没有键盘处理**（`onKeyDown`）—— 核实并给出影响。
   有没有 `<button>` 嵌套 `<button>`（HTML 非法，React 会警告）？

6. **文案一致性** —— 中文标点是否全角？有没有中英夹杂？
   有没有「还没有人说什么。」这种句号后缀不统一的问题？
   按钮上的动词是不是人话？

7. **死交互** —— 界面上有没有点了不动的东西（NOTES.md 记了几个刻意不画的，
   那些**不算**）—— 找的是**画了但没接后端**的。逐个 `onClick` 追到底。

可以起 `npx vite dev --port 5298` 亲眼看（dev 模式绕过 Access）。
跑完把 dev 关掉。报告里写明你实际看到了什么。
