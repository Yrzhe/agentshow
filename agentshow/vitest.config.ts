import { defineConfig } from "vitest/config";

/**
 * 纯逻辑单测跑在 node 环境，不带 Cloudflare 插件 —— 它会把测试拉进 workerd，
 * 对不碰 Worker 运行时的代码是白付出的启动成本。
 *
 * Task 2 要用 runInDurableObject 断言 DO 内部状态，那时再加
 * @cloudflare/vitest-pool-workers 的 project 配置。
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["__tests__/**/*.test.ts"]
  }
});
