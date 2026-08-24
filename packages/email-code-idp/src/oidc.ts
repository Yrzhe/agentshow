// The OIDC surface Cloudflare Access talks to, and the login flow behind it.
//
// Access is configured as a generic OIDC integration pointing at four of these endpoints. It sends
// the browser to /authorize, receives a callback carrying an authorization code, exchanges that
// code at /token, and verifies the resulting id_token against /jwks. Everything Access needs from
// this Worker is the `email` claim in that token -- the address it will then hand to the
// application as `cf-access-jwt-assertion`.

import {
  CODE_DIGITS,
  generateCode,
  generateToken,
  isCodeShaped,
  isEmailShaped,
  normalizeCode,
  normalizeEmail,
  subjectFor,
} from "./code.js";
import { isAllowedEmail, readConfig, type IdpConfig } from "./config.js";
import { renderCodeMessage, resendSender } from "./email.js";
import { publicJwk, signJwt, verifyJwt } from "./jwt.js";
import { codePage, emailPage, errorPage } from "./pages.js";
import type { AuthRequest, VerifyFailure } from "./store.js";

/** How long an authorization code stays exchangeable. Access redeems it immediately. */
const AUTH_CODE_TTL_MS = 60_000;
/** How long an access token is accepted at `/userinfo`. */
const ACCESS_TOKEN_TTL_S = 300;
/** How long an id_token stays valid. Access consumes it at once and mints its own session. */
const ID_TOKEN_TTL_S = 300;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function oauthError(error: string, description: string, status = 400): Response {
  return json({ error, error_description: description }, status);
}

/** Constant-time string comparison, for the client secret. */
function secretEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

function sessions(ctx: ExecutionContext) {
  return ctx.exports.LoginSession;
}

/** The message shown for each way a submitted code can fail. */
function verifyMessage(reason: VerifyFailure, attemptsLeft: number): string {
  switch (reason) {
    case "expired":
      return "That code has expired. Send a new one and try again.";
    case "too-many-attempts":
      return "Too many incorrect attempts. Send a new code and try again.";
    case "mismatch":
      return attemptsLeft === 1
        ? "That code is not correct. One more attempt before it is cancelled."
        : `That code is not correct. ${attemptsLeft} attempts left.`;
    case "no-code":
      // Also what an address outside the allowlist reaches, which is why it says nothing about why.
      return "That code is not valid. Send a new one and try again.";
  }
}

/**
 * `GET /authorize`: validate the OIDC request, then start a login.
 *
 * A bad `client_id` or `redirect_uri` renders an error rather than redirecting. Redirecting an
 * unvalidated `redirect_uri` is how an OIDC provider becomes an open redirector, and worse, how it
 * delivers codes to whoever asked.
 */
async function handleAuthorize(
  url: URL, config: IdpConfig, ctx: ExecutionContext,
): Promise<Response> {
  const clientId = url.searchParams.get("client_id") ?? "";
  const redirectUri = url.searchParams.get("redirect_uri") ?? "";
  if (clientId !== config.clientId) {
    return errorPage({ brand: config.brand, message: "This sign-in link is not for this service." });
  }
  if (redirectUri !== config.redirectUri) {
    return errorPage({
      brand: config.brand,
      message: "This sign-in request asked to return to an address this service does not recognise.",
    });
  }

  const state = url.searchParams.get("state");
  const nonce = url.searchParams.get("nonce");
  const responseType = url.searchParams.get("response_type") ?? "";
  if (responseType !== "code") {
    // Safe to bounce now: the redirect_uri is the configured one.
    const target = new URL(redirectUri);
    target.searchParams.set("error", "unsupported_response_type");
    if (state) target.searchParams.set("state", state);
    return Response.redirect(target.toString(), 302);
  }

  const session = generateToken();
  const request: AuthRequest = { clientId, redirectUri, state, nonce };
  // The session outlives one code so a mistyped entry can be retried without restarting at Access.
  await sessions(ctx).getByName(session).start(request, config.codeTtlMs * 3);
  return emailPage({ brand: config.brand, session });
}

/**
 * `POST /authorize/email`: mint a code for the submitted address and mail it.
 *
 * Always renders the code page, whatever happened. An address outside the allowlist, or one that
 * has had its allowance for the hour, gets the same page as one that was just mailed -- otherwise
 * this endpoint answers "does this person have access here?" for anyone who asks. It is the same
 * trade Cloudflare's own one-time PIN makes, and the reason the page cannot promise the mail is on
 * its way, only that a code was requested.
 */
async function handleEmailSubmit(
  form: FormData, config: IdpConfig, ctx: ExecutionContext,
): Promise<Response> {
  const session = String(form.get("session") ?? "");
  const stub = sessions(ctx).getByName(session);
  const request = await stub.request();
  if (!session || !request) {
    return errorPage({
      brand: config.brand,
      message: "This sign-in attempt has expired.",
    });
  }

  const email = normalizeEmail(String(form.get("email") ?? ""));
  if (!isEmailShaped(email)) {
    return emailPage({
      brand: config.brand,
      session,
      email,
      error: "Enter a valid email address.",
    });
  }

  const sends = await stub.sends();
  const withinSession = sends < config.maxSendsPerSession;
  const withinAllowlist = isAllowedEmail(email, config);
  // Ordered so the per-address throttle is only consumed by an address that would really be mailed.
  const withinThrottle = withinSession && withinAllowlist
    ? await ctx.exports.EmailThrottle.getByName(email)
      .allow(config.maxSendsPerEmail, config.sendWindowMs)
    : false;

  if (withinSession && withinAllowlist && withinThrottle) {
    const code = generateCode();
    await stub.issue(email, code, config.codeTtlMs);
    const message = renderCodeMessage({
      brand: config.brand,
      code,
      ttlMinutes: Math.round(config.codeTtlMs / 60_000),
    });
    const send = resendSender({ apiKey: config.mailApiKey, from: config.mailFrom });
    try {
      // Awaited rather than deferred: a delivery failure has to reach the page, because somebody
      // waiting for mail that will never arrive has no other way to find out.
      await send(email, message);
    } catch (error) {
      // Said plainly instead of as a 500. A provider outage is not the visitor's fault and not
      // something they can debug, but "try again" is genuinely the right advice, and the
      // alternative is a blank error page in front of a login they cannot complete.
      console.error(`email-code-idp delivery failed: ${(error as Error).message}`);
      return codePage({
        brand: config.brand,
        session,
        email,
        digits: CODE_DIGITS,
        error: "We could not send a code just now. Send a new one in a moment.",
        canResend: sends + 1 < config.maxSendsPerSession,
      });
    }
  }

  return codePage({
    brand: config.brand,
    session,
    email,
    digits: CODE_DIGITS,
    canResend: sends + 1 < config.maxSendsPerSession,
  });
}

/** `POST /authorize/code`: spend an attempt, and on success hand Access an authorization code. */
async function handleCodeSubmit(
  form: FormData, config: IdpConfig, ctx: ExecutionContext,
): Promise<Response> {
  const session = String(form.get("session") ?? "");
  const stub = sessions(ctx).getByName(session);
  const [request, email] = await Promise.all([stub.request(), stub.claimedEmail()]);
  if (!session || !request || !email) {
    return errorPage({ brand: config.brand, message: "This sign-in attempt has expired." });
  }

  const page = (error: string, sends: number) => codePage({
    brand: config.brand,
    session,
    email,
    digits: CODE_DIGITS,
    error,
    canResend: sends < config.maxSendsPerSession,
  });

  const code = normalizeCode(String(form.get("code") ?? ""));
  if (!isCodeShaped(code)) {
    // Not an attempt: rejecting a typo without spending one of five is the difference between a
    // limit that protects the code and a limit that punishes the user.
    return page(`Enter the ${CODE_DIGITS}-digit code from your email.`, await stub.sends());
  }

  const result = await stub.verify(code, config.maxAttempts);
  if (!result.ok) {
    return page(verifyMessage(result.reason, result.attemptsLeft), await stub.sends());
  }

  const authCode = generateToken();
  await ctx.exports.AuthCode.getByName(authCode).put({
    email: result.email,
    clientId: request.clientId,
    redirectUri: request.redirectUri,
    nonce: request.nonce,
    expiresAt: Date.now() + AUTH_CODE_TTL_MS,
  });
  await stub.finish();

  const target = new URL(request.redirectUri);
  target.searchParams.set("code", authCode);
  if (request.state) target.searchParams.set("state", request.state);
  return Response.redirect(target.toString(), 302);
}

/** Client credentials from either the Basic header or the form body, as OAuth allows both. */
function clientCredentials(request: Request, form: FormData): { id: string; secret: string } {
  const header = request.headers.get("authorization") ?? "";
  if (header.toLowerCase().startsWith("basic ")) {
    try {
      const decoded = atob(header.slice(6));
      const separator = decoded.indexOf(":");
      if (separator >= 0) {
        return {
          id: decodeURIComponent(decoded.slice(0, separator)),
          secret: decodeURIComponent(decoded.slice(separator + 1)),
        };
      }
    } catch {
      // Falls through to the form fields, which is where a malformed header should land anyway.
    }
  }
  return { id: String(form.get("client_id") ?? ""), secret: String(form.get("client_secret") ?? "") };
}

/** `POST /token`: exchange a single-use authorization code for an id_token. */
async function handleToken(
  request: Request, config: IdpConfig, ctx: ExecutionContext,
): Promise<Response> {
  const form = await request.formData();
  const credentials = clientCredentials(request, form);
  if (!secretEquals(credentials.id, config.clientId) ||
      !secretEquals(credentials.secret, config.clientSecret)) {
    return oauthError("invalid_client", "Client authentication failed.", 401);
  }
  if (String(form.get("grant_type") ?? "") !== "authorization_code") {
    return oauthError("unsupported_grant_type", "Only authorization_code is supported.");
  }

  const code = String(form.get("code") ?? "");
  if (!code) return oauthError("invalid_request", "code is required.");
  const record = await ctx.exports.AuthCode.getByName(code).redeem();
  if (!record) {
    return oauthError("invalid_grant", "That authorization code has expired or was already used.");
  }
  const redirectUri = form.get("redirect_uri");
  if (redirectUri !== null && String(redirectUri) !== record.redirectUri) {
    return oauthError("invalid_grant", "redirect_uri does not match the authorization request.");
  }

  const keys = await ctx.exports.SigningKey.getByName("current").current();
  const issuedAt = Math.floor(Date.now() / 1000);
  const subject = await subjectFor(record.email);
  const [idToken, accessToken] = await Promise.all([
    signJwt({
      iss: config.issuer,
      sub: subject,
      aud: record.clientId,
      iat: issuedAt,
      exp: issuedAt + ID_TOKEN_TTL_S,
      email: record.email,
      // The address was proven by delivery a moment ago, which is the whole basis of this provider.
      email_verified: true,
      ...(record.nonce ? { nonce: record.nonce } : {}),
    }, keys),
    signJwt({
      iss: config.issuer,
      sub: subject,
      aud: `${config.issuer}/userinfo`,
      iat: issuedAt,
      exp: issuedAt + ACCESS_TOKEN_TTL_S,
      email: record.email,
    }, keys),
  ]);

  return json({
    access_token: accessToken,
    id_token: idToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_S,
    scope: "openid email",
  });
}

/** `GET /userinfo`: the same claims again, for verifiers that ask for them separately. */
async function handleUserinfo(request: Request, config: IdpConfig, ctx: ExecutionContext) {
  const header = request.headers.get("authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) {
    return new Response(null, { status: 401, headers: { "www-authenticate": "Bearer" } });
  }
  const keys = await ctx.exports.SigningKey.getByName("current").current();
  const claims = await verifyJwt(header.slice(7).trim(), keys);
  if (!claims || claims["aud"] !== `${config.issuer}/userinfo`) {
    return new Response(null, {
      status: 401,
      headers: { "www-authenticate": "Bearer error=\"invalid_token\"" },
    });
  }
  return json({ sub: claims["sub"], email: claims["email"], email_verified: true });
}

/** The discovery document, so the integration can be checked without reading this file. */
function discovery(config: IdpConfig): Response {
  return json({
    issuer: config.issuer,
    authorization_endpoint: `${config.issuer}/authorize`,
    token_endpoint: `${config.issuer}/token`,
    userinfo_endpoint: `${config.issuer}/userinfo`,
    jwks_uri: `${config.issuer}/jwks`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    scopes_supported: ["openid", "email"],
    claims_supported: ["iss", "sub", "aud", "exp", "iat", "nonce", "email", "email_verified"],
    token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
  });
}

/**
 * Every request this Worker answers.
 *
 * `config` is read per request rather than cached: it is cheap, and a Worker that validated its
 * configuration once at startup would keep serving from a stale isolate after a bad deploy.
 */
export async function handleRequest(
  request: Request, env: Cloudflare.Env, ctx: ExecutionContext,
): Promise<Response> {
  let config: IdpConfig;
  try {
    config = readConfig(env);
  } catch (error) {
    // Configuration is the operator's problem, not the visitor's, so it is logged in full and
    // summarised on the page.
    console.error(`email-code-idp configuration error: ${(error as Error).message}`);
    return errorPage({
      brand: "this service",
      message: "Sign-in is not configured correctly. Please contact whoever runs this deployment.",
      status: 500,
    });
  }

  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "") || "/";
  const method = request.method.toUpperCase();

  if (method === "GET" && path === "/.well-known/openid-configuration") return discovery(config);
  if (method === "GET" && path === "/jwks") {
    const keys = await ctx.exports.SigningKey.getByName("current").current();
    return json({ keys: [publicJwk(keys)] });
  }
  if (method === "GET" && path === "/authorize") return handleAuthorize(url, config, ctx);
  if (method === "POST" && (path === "/authorize/email" || path === "/authorize/code")) {
    // A cross-site POST cannot reach here with a usable session token, but the check costs nothing
    // and keeps the form endpoints answering only to pages this Worker served.
    const origin = request.headers.get("origin");
    if (origin !== null && origin !== config.issuer && origin !== url.origin) {
      return errorPage({ brand: config.brand, message: "That request did not come from sign-in." });
    }
    const form = await request.formData();
    return path === "/authorize/email"
      ? handleEmailSubmit(form, config, ctx)
      : handleCodeSubmit(form, config, ctx);
  }
  if (method === "POST" && path === "/token") return handleToken(request, config, ctx);
  if ((method === "GET" || method === "POST") && path === "/userinfo") {
    return handleUserinfo(request, config, ctx);
  }

  return errorPage({ brand: config.brand, message: "There is nothing at this address.", status: 404 });
}
