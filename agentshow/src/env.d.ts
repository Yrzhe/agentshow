/**
 * Cloudflare Access 的两个 Worker secret。
 *
 * 它们是 secret 不是 var，所以不进 wrangler.jsonc，`wrangler types` 也就看不到。
 * 在这里做接口合并声明，CI 里没有 .dev.vars 也能通过类型检查。
 *
 * 值从 dashboard 开启 Access 后弹出的面板里拿：
 *   npx wrangler secret put POLICY_AUD
 *   npx wrangler secret put TEAM_DOMAIN
 */
interface Env {
  POLICY_AUD?: string;
  TEAM_DOMAIN?: string;
}
