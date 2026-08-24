import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./__tests__/worker.ts",
      miniflare: {
        compatibilityDate: "2026-08-04",
        compatibilityFlags: ["nodejs_compat"],
        // Production reaches these through `ctx.exports` and needs no bindings. The suites drive
        // the Durable Objects directly for the limit cases, which does.
        durableObjects: {
          LOGIN_SESSION: { className: "LoginSession", useSQLite: true },
          AUTH_CODE: { className: "AuthCode", useSQLite: true },
          EMAIL_THROTTLE: { className: "EmailThrottle", useSQLite: true },
          SIGNING_KEY: { className: "SigningKey", useSQLite: true },
        },
        bindings: {
          IDP_ISSUER: "https://login.example.com",
          IDP_BRAND: "Example OS",
          IDP_CLIENT_ID: "test-client",
          IDP_CLIENT_SECRET: "test-client-secret",
          IDP_REDIRECT_URI: "https://example.cloudflareaccess.com/cdn-cgi/access/callback",
          IDP_ALLOWED_EMAILS: "@example.com,allowed@other.test",
          IDP_MAIL_FROM: "Example OS <login@example.com>",
          IDP_MAIL_API_KEY: "test-mail-key",
          IDP_CODE_TTL_SECONDS: "600",
          IDP_MAX_ATTEMPTS: "3",
          IDP_MAX_SENDS_PER_SESSION: "3",
          IDP_MAX_SENDS_PER_EMAIL: "4",
          IDP_SEND_WINDOW_SECONDS: "3600",
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
