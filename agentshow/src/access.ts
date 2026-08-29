import { createRemoteJWKSet, jwtVerify } from "jose";

/**
 * Cloudflare Access 校验。
 *
 * Access 挂在 Worker 上，请求到达我们之前就已经被拦过一道。这里再验一次 JWT，
 * 是为了让 Worker 自己也拒绝没走 Access 的请求 —— 策略被误改或被绕过时，
 * 这一层是最后的闸。
 *
 * 通过之后返回已验证的邮箱：那就是 members 表里人类成员的身份，
 * 不是额外产物。
 */

/** Access 注入的头，全小写。 */
const ACCESS_HEADER = "cf-access-jwt-assertion";

const CERTS_PATH = "/cdn-cgi/access/certs";

export type AccessResult =
  | { ok: true; email: string }
  | { ok: false; response: Response };

/**
 * TEAM_DOMAIN 两种写法都接受：团队 URL（https://x.cloudflareaccess.com）
 * 或者直接给到 certs 的完整地址。issuer 永远是 origin。
 */
export function accessUrls(teamDomain: string): { issuer: string; certsUrl: URL } {
  const teamUrl = new URL(teamDomain);
  const issuer = teamUrl.origin;
  const certsUrl = teamUrl.pathname.endsWith(CERTS_PATH)
    ? teamUrl
    : new URL(CERTS_PATH, issuer);
  return { issuer, certsUrl };
}

/**
 * JWKS 按 certs 地址缓存在模块作用域。
 * createRemoteJWKSet 自己有缓存，但每个请求新建一个就等于每次都重新拉一遍。
 */
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function jwks(certsUrl: URL) {
  const key = certsUrl.toString();
  let set = jwksCache.get(key);
  if (!set) {
    set = createRemoteJWKSet(certsUrl);
    jwksCache.set(key, set);
  }
  return set;
}

export async function verifyAccess(
  request: Request,
  env: { POLICY_AUD?: string; TEAM_DOMAIN?: string },
  options: { isDev: boolean }
): Promise<AccessResult> {
  // 本地开发前面没有 Access，不可能有这个头。用一个固定身份，
  // 免得每次开发都要配一套 Access。
  if (options.isDev) {
    return { ok: true, email: "dev@localhost" };
  }

  // 生产环境缺配置就是没有鉴权 —— 宁可整个服务 500，也不能默默放行。
  if (!env.POLICY_AUD || !env.TEAM_DOMAIN) {
    return {
      ok: false,
      response: new Response(
        "Cloudflare Access 未配置。生产环境必须设置 POLICY_AUD 和 TEAM_DOMAIN。",
        { status: 500 }
      )
    };
  }

  const token = request.headers.get(ACCESS_HEADER);
  if (!token) {
    return { ok: false, response: new Response("缺少 Access JWT", { status: 403 }) };
  }

  try {
    const { issuer, certsUrl } = accessUrls(env.TEAM_DOMAIN);
    const { payload } = await jwtVerify(token, jwks(certsUrl), {
      issuer,
      audience: env.POLICY_AUD
    });

    const email = typeof payload.email === "string" ? payload.email : null;
    if (!email) {
      // 走到这里说明 token 有效但没带 email —— service token 之类的非人类身份。
      // 这个产品的人类成员必须有邮箱，所以拒绝而不是放行成匿名。
      return {
        ok: false,
        response: new Response("Access token 未携带 email", { status: 403 })
      };
    }

    return { ok: true, email };
  } catch {
    return { ok: false, response: new Response("Access token 无效或已过期", { status: 403 }) };
  }
}
