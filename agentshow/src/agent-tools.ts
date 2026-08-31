import { tool } from "ai";
import type { ToolSet } from "ai";
import { z } from "zod";
import type { ProjectDO } from "./project";

/**
 * 作用于 project 公共区的工具。
 *
 * 名字一律 xxxProjectFile，避开 Think 内置的 read / write / edit / list /
 * find / grep / delete / bash —— 那八个作用于 agent 自己的私有盘。
 * Think 的合并顺序是后者覆盖先前，撞名会静默顶掉内置工具且不报错。
 */
export const PROJECT_TOOL_NAMES = [
  "listProjectFiles",
  "readProjectFile",
  "writeProjectFile",
  "commentOnProjectFile",
  "mentionAgent"
] as const;

export type ProjectToolDeps = {
  project: DurableObjectStub<ProjectDO>;
  /** 谁在干这件事 —— 文件归属、评论作者、提及发起方都用它。 */
  authorId: string;
  /**
   * 投递一条 @提及。做成回调而不是让这里直接拿 env，
   * 是为了把「怎么投递」留在 server.ts，这个模块只管定义工具。
   */
  mention: (input: {
    toAgentName: string;
    path: string;
    message: string;
  }) => Promise<{ ok: boolean; reason?: string }>;
};

export function projectTools({
  project,
  authorId,
  mention
}: ProjectToolDeps): ToolSet {
  return {
    listProjectFiles: tool({
      description:
        "列出当前 project 公共区里的所有文件，含归属和版本号。" +
        "公共区是这个 project 里所有成员共享的，跟你自己的私有盘是两回事。",
      inputSchema: z.object({}),
      execute: async () => project.listFiles()
    }),

    readProjectFile: tool({
      description:
        "读 project 公共区的一个文件。返回内容和版本号。" +
        "记住这个版本号 —— 写回时必须原样带上，否则会被拒绝。" +
        "文件不存在时返回 null。",
      inputSchema: z.object({
        path: z.string().describe("公共区里的文件路径，例如 spec.md")
      }),
      execute: async ({ path }) => project.readFile(path)
    }),

    // 这段 description 是整个 Task 里最重要的一段文字，不是注释。
    // 乐观并发成不成立，取决于模型看到 stale 之后是重做还是报错放弃，
    // 而它唯一的依据就是这里写没写清楚。
    writeProjectFile: tool({
      description:
        "写 project 公共区的文件。baseVersion 必须是你刚才用 readProjectFile " +
        "读到的那个版本号；文件还不存在时传 0。\n" +
        "如果返回 { ok: false, reason: \"stale\" }，说明在你思考期间别人改了这个文件。" +
        "这不是错误，是正常情况 —— 返回里的 content 就是当前的最新内容，version 是当前版本号。" +
        "请在这份新内容的基础上重新做一遍你的修改，然后用新的 version 作为 baseVersion 重试。" +
        "不要放弃，也不要把 stale 当作失败报告给用户。",
      inputSchema: z.object({
        path: z.string().describe("公共区里的文件路径"),
        content: z.string().describe("文件的完整新内容，不是补丁"),
        baseVersion: z
          .number()
          .describe("你读到这个文件时的版本号；新文件传 0")
      }),
      execute: async (input) => project.writeFile({ ...input, authorId })
    }),

    // 评论是复审 agent 的产出，也是人类看到的东西。
    // 这段说明在逼它给具体的 —— 一句「建议优化一下」不如没有，
    // 它既不能让人判断，也不能让另一个 agent 据此行动。
    commentOnProjectFile: tool({
      description:
        "在 project 公共区的某个文件上留一条评论。评论挂在文件上，" +
        "所有能看到这个文件的人和 agent 都会看到。\n" +
        "写具体的：指出是哪一处、会导致什么后果、建议怎么改。" +
        "不要写「建议优化一下」「整体不错」这类没有信息量的话 —— " +
        "看的人无法据此判断，别的 agent 也无法据此行动。\n" +
        "定位到具体位置时用 anchor 标出来，例如「第 42 行」；" +
        "针对整体的评价可以不填。",
      inputSchema: z.object({
        path: z.string().describe("要评论的文件路径"),
        text: z.string().describe("评论正文，要具体"),
        anchor: z
          .string()
          .optional()
          .describe("可选，定位到文件的哪一处，例如「第 42 行」")
      }),
      execute: async (input) => {
        project.addComment({ ...input, authorId });
        return { ok: true };
      }
    }),

    // 这是你能让另一个 agent 动起来的唯一方式 —— 没有群聊，
    // 所以 agent 之间不共享消息流。
    mentionAgent: tool({
      description:
        "在某个文件上 @ 另一个 agent，把它叫来处理。被 @ 的 agent 会收到通知，" +
        "读那个文件，然后决定怎么做 —— 它可能改文件，也可能只留评论。\n" +
        "先把你的产出写进公共区，再 @ 人来看，不要 @ 完了才写。\n" +
        "message 里说清你要它做什么、看哪里。别的 agent 看不到你和用户的对话，" +
        "它只有这条消息和那个文件。\n" +
        "如果返回 unknown_agent，说明这个名字不在本 project 的成员里 —— " +
        "先用 listProjectFiles 之外的方式确认名字，或者直接告诉用户没找到这个人，" +
        "不要假装已经通知到了。",
      inputSchema: z.object({
        toAgentName: z.string().describe("要 @ 的 agent 名字，例如 Verdigris"),
        path: z.string().describe("讨论围绕哪个文件"),
        message: z.string().describe("你要它做什么，说具体")
      }),
      execute: async (input) => mention(input)
    })
  };
}
