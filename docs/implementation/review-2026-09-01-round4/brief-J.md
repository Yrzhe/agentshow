# Lane J —— 删掉的东西有没有带走别的，以及测试是不是被改松了

先读 /tmp/agentshow-r4/CONTEXT.md。
worktree：/tmp/agentshow-r4/wt-J   输出：/tmp/agentshow-r4/out-J.md
完成后：touch /tmp/agentshow-r4/DONE-J

## 你的任务

这一批**以删代码为主**。删除引起的回归比新增更难看见，因为它表现为
「某个地方不再发生某件事」，而没有任何报错。

1. **测试是不是被改松了 —— 这一条我自己先招认，请独立核实。**
   `git diff 085cbe4..HEAD -- '**/__tests__/**'`。
   我把**两处 `toEqual` 改成了 `toMatchObject`**，理由是返回值多了 `depth` 字段。
   逐条判断：
   - 这个放松有没有让原本能抓到的问题不再能抓到？
   - 有没有更好的写法（比如显式断言完整形状，包含 depth）？
   - 这一批**删掉了 3 条测试**（原深度编解码的），新增了几条。
     净变化覆盖住了被删的那些行为吗？还是有行为现在完全没测试守着？
   - 新增的断言是在**约束行为**，还是在**描述当前实现**？

2. **`depthOf` / `depthLine` / `depthInText` / `stripDepthMarks` 被删干净了吗。**
   grep 全仓（含测试、脚本、文档、注释）。有没有悬空的引用、
   过时的注释、或者文档里还在描述旧机制的地方？
   `docs/architecture/agentshow-design.md` 和 `CHANGELOG.md` 现在准不准？

3. **`notifyMention` 不再往正文追加东西之后。**
   - `depth` 参数还传进 `notifyMention` 吗？传了但没用吗？
     （看 `src/server.ts` 的 `notifyMention` 签名和函数体）
   - 被叫醒的 agent 现在**完全不知道自己在第几跳**。
     这有没有影响？`src/agent-tools.ts` 里 `mentionAgent` 的 description
     承诺了什么、模型收到 `max_depth` 时能不能理解发生了什么？
     （这是「prompt ↔ 数据流一致性」：prompt 让模型做的事，它有信息做吗）

4. **`workspace.ts` 的三处改动是新的失败模式。**
   - `addProject` 现在**抛异常**。谁调用它？调用方有没有 catch？
     `src/api.ts` 的 `POST /api/projects` 抛出去会变成什么响应码？
     zod 已经在 schema 层挡了 `dm`，那这个抛还有可达路径吗？
     如果不可达，它是死代码还是纵深防御？（两种都可以，但要说清是哪种）
   - `listProjects` 现在**静默过滤**掉非法行。用户会看到「我的项目少了一个」
     而没有任何解释。这比列出一个打不开的 project 好吗？
   - `getProject` 对 `dm` 返回 null → API 返回 404。
     一个存在但被判非法的 project 返回 404，用户怎么理解？

5. **`FileDetail.tsx` 的动作快照。**
   `JSON.stringify([target?.memberId ?? null, path, text.trim()])` 做键。
   - `path` 从哪来、会不会变？组件重挂载时 `action` ref 重置吗？该不该？
   - 只有 `target` 存在时才生成 id（`if (target && ...)`）。
     从「提及」切回「普通评论」再切回来，会怎样？
   - 评论那条路径（没有 target）完全没有幂等。这是有意的吗？合理吗？

6. **回归：基本链路。**
   `git diff 6b480e0..HEAD` 是从原始代码到现在的全部改动。
   有没有哪一处在这几轮里被顺手改坏了，而没有任何测试守着？
   特别看那些**只被删除触及**的地方。

可以跑测试（**核对 15 文件 125 条**）。静态 + 单测足够，不需要起 dev。
