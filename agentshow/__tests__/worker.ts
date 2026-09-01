import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import { AgentDO as RealAgentDO } from "../src/server";

/**
 * 测试用的 Worker 入口。
 *
 * 存在的唯一理由是**不让测试真的去打一次推理**。`notifyMention` 走
 * `submitMessages`，而它会排一轮真正的模型调用 —— 测试断言完早就返回了，
 * 那一轮还在后台跑。后果有三条：CI 每跑一次都花真钱、结果不确定、
 * 而且模型调用失败时抛出的错误落在所有测试之外，vitest 记成 unhandled
 * error 然后退 1（实测：17 个文件 166 条全过，Errors 9，退出码 1）。
 *
 * 生产代码里一个字都不为测试让路：这里只是继承 AgentDO 换掉 getModel()，
 * 其余导出原样透传。wrangler.jsonc 的 migration 绑的是类名，子类同名即可。
 */

export { AgentIdentityDO, ProjectDO, WorkspaceDO } from "../src/server";
export { default } from "../src/server";

export class AgentDO extends RealAgentDO {
  getModel() {
    const chunks: LanguageModelV4StreamPart[] = [
      { type: "text-start", id: "0" },
      { type: "text-delta", id: "0", delta: "好的。" },
      { type: "text-end", id: "0" },
      {
        type: "finish",
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: {
            total: 1,
            noCache: 1,
            cacheRead: undefined,
            cacheWrite: undefined
          },
          outputTokens: { total: 1, text: 1, reasoning: undefined }
        }
      }
    ];

    return new MockLanguageModelV4({
      doStream: async () => ({ stream: simulateReadableStream({ chunks }) })
    });
  }
}
