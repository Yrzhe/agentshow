import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import capnwebValidate from "capnweb-validate/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    capnwebValidate(),
    cloudflareTest({
      main: "./__tests__/worker.ts",
      miniflare: {
        compatibilityDate: "2026-08-04",
        compatibilityFlags: ["allow_irrevocable_stub_storage", "nodejs_compat"],
        // Production reaches these through `ctx.exports` and needs no bindings. The suites reach
        // them from outside the Worker, which does.
        durableObjects: {
          PROJECT_STORE: { className: "ProjectDurableObject", useSQLite: true },
          MEMBER_PROJECTS: { className: "MemberProjectsDurableObject", useSQLite: true },
        },
        r2Buckets: ["PROJECT_FILES"],
        bindings: {
          PUBLIC_BASE_URL: "https://os.example.com",
          PROJECT_SHARING_DOMAIN: "https://os.example.com",
          // Small enough that a quota suite can reach them without writing megabytes.
          PROJECT_MAX_FILE_BYTES: "4096",
          PROJECT_MAX_TOTAL_BYTES: "8192",
          PROJECT_MAX_FILE_COUNT: "5",
        },
      },
    }),
  ],
  test: {
    include: ["__tests__/*.test.ts"],
    // Asserts the pool actually started, rather than trusting a green run to mean workerd.
    setupFiles: ["../../cloudflare-os/scripts/assert-workerd.ts"],
  },
});
