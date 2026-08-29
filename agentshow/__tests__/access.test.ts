import { describe, expect, it } from "vitest";
import { accessUrls, verifyAccess } from "../src/access";

const PROD = { isDev: false };
const CONFIGURED = {
  POLICY_AUD: "aud-123",
  TEAM_DOMAIN: "https://yrzhe.cloudflareaccess.com"
};

function req(headers: Record<string, string> = {}) {
  return new Request("https://agentshow.example/", { headers });
}

describe("accessUrls", () => {
  it("团队 URL 形式 — 自动补上 certs 路径", () => {
    const { issuer, certsUrl } = accessUrls("https://yrzhe.cloudflareaccess.com");
    expect(issuer).toBe("https://yrzhe.cloudflareaccess.com");
    expect(certsUrl.toString()).toBe(
      "https://yrzhe.cloudflareaccess.com/cdn-cgi/access/certs"
    );
  });

  it("完整 certs URL 形式 — 原样使用，不重复拼接", () => {
    const full = "https://yrzhe.cloudflareaccess.com/cdn-cgi/access/certs";
    const { issuer, certsUrl } = accessUrls(full);
    expect(issuer).toBe("https://yrzhe.cloudflareaccess.com");
    expect(certsUrl.toString()).toBe(full);
  });

  it("issuer 永远是 origin，不带路径", () => {
    const { issuer } = accessUrls(
      "https://yrzhe.cloudflareaccess.com/cdn-cgi/access/certs"
    );
    expect(issuer).toBe("https://yrzhe.cloudflareaccess.com");
  });
});

describe("verifyAccess", () => {
  it("本地开发直接放行，给一个固定身份", async () => {
    const r = await verifyAccess(req(), {}, { isDev: true });
    expect(r).toEqual({ ok: true, email: "dev@localhost" });
  });

  // 这三条是这个模块存在的理由：配置缺失时必须整个服务不可用，
  // 而不是默默变成一个无鉴权的公开服务。
  it("生产环境缺 POLICY_AUD — 500 fail closed，不是放行", async () => {
    const r = await verifyAccess(req(), { TEAM_DOMAIN: CONFIGURED.TEAM_DOMAIN }, PROD);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(500);
  });

  it("生产环境缺 TEAM_DOMAIN — 500 fail closed", async () => {
    const r = await verifyAccess(req(), { POLICY_AUD: CONFIGURED.POLICY_AUD }, PROD);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(500);
  });

  it("两个都缺 — 500 fail closed", async () => {
    const r = await verifyAccess(req(), {}, PROD);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(500);
  });

  it("配置齐全但请求没带 Access 头 — 403", async () => {
    const r = await verifyAccess(req(), CONFIGURED, PROD);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(403);
  });

  it("token 格式非法 — 403，且在解析阶段就失败，不发起 JWKS 请求", async () => {
    const r = await verifyAccess(
      req({ "cf-access-jwt-assertion": "not-a-jwt" }),
      CONFIGURED,
      PROD
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(403);
  });
});
