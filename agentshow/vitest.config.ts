import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

/**
 * 两个 project 并存：
 *
 * - node    纯逻辑单测（如 Access 的 URL 推导和失败路径），不碰 Worker 运行时，
 *           跑在 node 里省掉 workerd 的启动成本。
 * - workers Durable Object 测试，必须在真 workerd 里跑才能用
 *           runInDurableObject 直接断言 DO 内部状态。
 *
 * cloudflareTest() 在 0.22 里返回的是 Vite 插件，不是老文档里的
 * defineWorkersConfig 配置包装器 —— 照旧教程写会报找不到导出。
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
          include: ["__tests__/*.test.ts"]
        }
      },
      {
        plugins: [
          cloudflareTest({
            // 不是 src/server.ts —— 那个入口会真的去打模型。
            // __tests__/worker.ts 只换掉 getModel()，其余原样透传。
            main: "./__tests__/worker.ts",
            wrangler: { configPath: "./wrangler.jsonc" }
          })
        ],
        test: {
          name: "workers",
          include: ["__tests__/do/*.test.ts"]
        }
      }
    ]
  }
});
