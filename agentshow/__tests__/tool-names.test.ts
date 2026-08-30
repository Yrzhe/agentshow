import { describe, expect, it } from "vitest";
import { PROJECT_TOOL_NAMES } from "../src/agent-tools";

/**
 * Think 每轮把工具从多个来源合并，**后来的覆盖先前的**：
 *   workspace 内置 → getTools() → 扩展 → session → skill → MCP → 客户端
 *
 * 所以自定义工具一旦跟内置八个之一同名，就会静默顶掉那个内置工具，
 * 不报错、不警告。这条断言看着琐碎，但它防的是一类查起来要命的故障。
 */
const BUILTIN_WORKSPACE_TOOLS = [
  "read",
  "write",
  "edit",
  "list",
  "find",
  "grep",
  "delete",
  "bash"
];

describe("project 工具命名", () => {
  it("不与 Think 内置的八个 workspace 工具相撞", () => {
    for (const name of PROJECT_TOOL_NAMES) {
      expect(BUILTIN_WORKSPACE_TOOLS).not.toContain(name);
    }
  });

  it("彼此不重名", () => {
    expect(new Set(PROJECT_TOOL_NAMES).size).toBe(PROJECT_TOOL_NAMES.length);
  });
});
