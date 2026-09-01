# Lane H —— 这一批修复自己引入了什么

先读 /tmp/agentshow-r3/CONTEXT.md。
worktree：/tmp/agentshow-r3/wt-H   输出：/tmp/agentshow-r3/out-H.md
完成后：touch /tmp/agentshow-r3/DONE-H

## 你的方法

**假设我又干了上一轮那种事** —— 修 A 的时候顺手造出 B。
不要复述已知问题，找**这一批 diff 新增的**问题。

## 逐条盯这些

1. **`stripDepthMarks` 会不会破坏正常内容**（`src/mention.ts`）
   它把匹配到的整段替换成「（深度标记已移除）」，塞进用户/agent 可见的正文里。
   - 一条完全正常的提及消息里，有没有可能**偶然**命中那个正则？
     （正则是全角括号包的一句中文。人在文件详情里 @ 别人时手打这句话呢？）
   - 替换成一句解释性中文，对读到它的**模型**意味着什么？
     它会不会以为自己被审查了、或者把这句话当指令？
   - 只在 `notifyMention` 里抹了。`p.message` 还有别的去向吗
     （活动流的 detail？评论？）—— 那些地方的同一段文字没被抹，会不会形成不一致？

2. **`depthInText` 取最大值的副作用**
   - 现在任何一段文本里出现的**最大**深度数字说了算。
     人在对话框里手打「（这是提及链的第 3 跳，最多 3 跳）」会怎样？
     `depthOf` 读的是最后一条 user 消息 —— 人类的聊天消息也走这条路吗？
     去 `src/server.ts` 的 `beforeTurn` 确认，并推出后果。
   - 数字没有上界检查（`\d+` 能匹配任意长）。`第 99999999999999999999 跳` 呢？
     `Number()` 的精度边界会不会让比较出错？

3. **`actionId` 的生命周期**（`src/ui/FileDetail.tsx`）
   - 它只在 `target` 存在时生成，成功后清空。**失败后不清**。
     用户失败之后**改了文案**再发 —— 复用同一个 id，服务端会怎样？
     新文案是不是被静默丢弃了？把这条追到底（服务端 `submitMessages`
     的幂等语义在 `node_modules/@cloudflare/think/docs/programmatic-submissions.md`）。
   - 用户失败之后**换了一个 @ 对象**再发呢？
   - 从提及切换成普通评论（取消 @）再发呢？`actionId` 还留着吗？
   - 组件 remount（换文件、换 project）时 ref 会重置吗？该不该重置？

4. **`duplicate` 改成 201 之后**
   `src/api.ts` 现在对 duplicate 返回 201。前端 `FileDetail.tsx` 的
   `if (!res?.ok)` 于是认为成功、清空输入框、`onDone()`。
   **但目标其实没有新一轮。** 这是想要的行为吗？
   用户看到的和实际发生的对得上吗？跟 `src/mention.ts` 里
   「不记活动」的决定放在一起看，界面上会呈现成什么？

5. **`isProjectId` 挡在哪一层**（`src/agent-key.ts` / `src/api.ts`）
   只在 `CreateProject` 的 zod 上挡了。**其它拿 projectId 的入口呢？**
   grep 所有会走到 `scoped(owner, projectId)` 或 `agentKey(..., projectId)` 的路径，
   逐条确认那个 projectId 的来源都过了这一关。
   特别看 `src/api.ts` 里从 URL 段取 projectId 的那几处。

6. **测试有没有被改松**
   `git diff ceae45e..HEAD -- '**/__tests__/**'`。
   新增的断言是在真正约束行为，还是在描述当前实现？
   有没有哪一条改动让原来能抓到问题的断言不再能抓到？

7. **结构**：`src/mention.ts` 现在同时管投递、深度编解码、消息清洗。
   `src/server.ts` 的 `depthOf` 又在外面包了一层。
   这个分工有没有让「深度」这件事散落在两个文件里？
   有没有一种收拢方式能让整类问题消失（而不是「这儿能干净点」）？

可以跑测试（**核对是 15 文件 128 条**）。不需要起 dev，静态 + 单测足够。
