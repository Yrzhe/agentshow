// The whole trip Access makes: /authorize, the emailed code, the callback, and the token exchange.
//
// Outbound delivery is intercepted rather than stubbed at the module boundary, so the code these
// tests type is genuinely the code the Worker put in an email.

import { SELF, reset } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ISSUER = "https://login.example.com";
const CLIENT_ID = "test-client";
const CLIENT_SECRET = "test-client-secret";
const REDIRECT_URI = "https://example.cloudflareaccess.com/cdn-cgi/access/callback";
const RESEND_ENDPOINT = "https://api.resend.com/emails";

interface SentMail { to: string; subject: string; text: string; html: string }

/** Every message the Worker handed to the delivery provider during one test. */
let sent: SentMail[] = [];

// The pool runs the Worker under test in this isolate, so a global spy sees the outbound request
// the Worker really made. Intercepting there rather than stubbing the sender module keeps the code
// these tests type genuinely the code that was put in an email, and makes any *other* outbound
// request a failure rather than a silent success.
beforeEach(async () => {
  sent = [];
  // The per-address send limit lives in a Durable Object, which outlives a test. Without this,
  // whichever suite ran first would use up the allowance for every address it touched.
  await reset();
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input
      : input instanceof URL ? input.href
      : (input as Request).url;
    if (url !== RESEND_ENDPOINT) {
      throw new Error(`Unexpected outbound request to ${url}`);
    }
    const payload = JSON.parse(String(init?.body ?? "{}")) as {
      to: string[]; subject: string; text: string; html: string;
    };
    sent.push({
      to: payload.to[0]!,
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
    });
    return new Response(JSON.stringify({ id: "test-message" }), { status: 200 });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function authorizeUrl(overrides: Record<string, string> = {}): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: "openid email",
    state: "state-value",
    nonce: "nonce-value",
    ...overrides,
  });
  return `${ISSUER}/authorize?${params}`;
}

/** Opens the login page and returns the session token embedded in its form. */
async function startLogin(url = authorizeUrl()): Promise<string> {
  const response = await SELF.fetch(url);
  expect(response.status).toBe(200);
  const session = /name="session" value="([\da-f]{64})"/.exec(await response.text())?.[1];
  expect(session, "the login page should carry a session token").toBeDefined();
  return session!;
}

function form(fields: Record<string, string>): RequestInit {
  return {
    method: "POST",
    body: new URLSearchParams(fields),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    redirect: "manual",
  };
}

async function submitEmail(session: string, email: string): Promise<Response> {
  return SELF.fetch(`${ISSUER}/authorize/email`, form({ session, email }));
}

async function submitCode(session: string, code: string): Promise<Response> {
  return SELF.fetch(`${ISSUER}/authorize/code`, form({ session, code }));
}

/** Reads the code out of the most recent email, exactly as a recipient would. */
function lastCode(): string {
  const mail = sent.at(-1);
  expect(mail, "an email should have been sent").toBeDefined();
  const code = /\b(\d{6})\b/.exec(mail!.text)?.[1];
  expect(code, "the email should contain a six digit code").toBeDefined();
  return code!;
}

async function exchange(code: string, extra: Record<string, string> = {}): Promise<Response> {
  return SELF.fetch(`${ISSUER}/token`, form({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    ...extra,
  }));
}

function decodeClaims(token: string): Record<string, unknown> {
  const segment = token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/");
  const padded = segment.padEnd(Math.ceil(segment.length / 4) * 4, "=");
  return JSON.parse(atob(padded)) as Record<string, unknown>;
}

/** Signs in end to end and returns the authorization code Access would receive. */
async function signIn(email = "ada@example.com"): Promise<string> {
  const session = await startLogin();
  await submitEmail(session, email);
  const response = await submitCode(session, lastCode());
  expect(response.status).toBe(302);
  const location = new URL(response.headers.get("location")!);
  return location.searchParams.get("code")!;
}

describe("the sign-in flow", () => {
  it("emails a code and redirects back to Access with an authorization code", async () => {
    const session = await startLogin();

    const emailed = await submitEmail(session, "ada@example.com");
    expect(emailed.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("ada@example.com");

    const redirected = await submitCode(session, lastCode());
    expect(redirected.status).toBe(302);
    const location = new URL(redirected.headers.get("location")!);
    expect(location.origin + location.pathname).toBe(REDIRECT_URI);
    expect(location.searchParams.get("code")).toMatch(/^[\da-f]{64}$/);
    // Returned untouched, which is what lets Access match the callback to the request it started.
    expect(location.searchParams.get("state")).toBe("state-value");
  });

  it("accepts a code typed with the spacing a mail client displays", async () => {
    const session = await startLogin();
    await submitEmail(session, "ada@example.com");
    const spaced = lastCode().replace(/^(\d{3})(\d{3})$/, "$1 $2");

    expect((await submitCode(session, spaced)).status).toBe(302);
  });

  it("mints a different code for each login", async () => {
    const first = await startLogin();
    await submitEmail(first, "ada@example.com");
    const firstCode = lastCode();
    const second = await startLogin();
    await submitEmail(second, "ada@example.com");

    expect(lastCode()).not.toBe(firstCode);
  });
});

describe("the token exchange", () => {
  it("returns an id_token carrying the verified address", async () => {
    const response = await exchange(await signIn("ada@example.com"));
    expect(response.status).toBe(200);

    const body = await response.json() as { id_token: string; token_type: string };
    expect(body.token_type).toBe("Bearer");
    const claims = decodeClaims(body.id_token);
    // The one claim the whole deployment depends on: Access hands it to the Workshop, which uses it
    // as the account identity and matches it against access.admins.
    expect(claims["email"]).toBe("ada@example.com");
    expect(claims["email_verified"]).toBe(true);
    expect(claims["iss"]).toBe(ISSUER);
    expect(claims["aud"]).toBe(CLIENT_ID);
    // Echoed back so Access can tie the token to the request it started.
    expect(claims["nonce"]).toBe("nonce-value");
  });

  it("lower-cases the address so one person keeps one account", async () => {
    const response = await exchange(await signIn("Ada@Example.com"));
    const body = await response.json() as { id_token: string };

    expect(decodeClaims(body.id_token)["email"]).toBe("ada@example.com");
  });

  it("issues an id_token that verifies against the published JWKS", async () => {
    // What Access actually does with the token. If this passes, the signature, the `kid`, and the
    // JWKS document all agree.
    const response = await exchange(await signIn());
    const { id_token: idToken } = await response.json() as { id_token: string };
    const { keys } = await (await SELF.fetch(`${ISSUER}/jwks`)).json() as { keys: JsonWebKey[] };

    const key = await crypto.subtle.importKey(
      "jwk", keys[0]!, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const [header, payload, signature] = idToken.split(".");
    const bytes = Uint8Array.from(
      atob(signature!.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

    expect(await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5", key, bytes, new TextEncoder().encode(`${header}.${payload}`))).toBe(true);
  });

  it("refuses to redeem the same authorization code twice", async () => {
    const code = await signIn();
    expect((await exchange(code)).status).toBe(200);

    const replayed = await exchange(code);
    expect(replayed.status).toBe(400);
    expect(await replayed.json()).toMatchObject({ error: "invalid_grant" });
  });

  it("refuses a wrong client secret", async () => {
    const response = await exchange(await signIn(), { client_secret: "wrong" });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "invalid_client" });
  });

  it("refuses a redirect_uri that does not match the request", async () => {
    const response = await exchange(await signIn(), { redirect_uri: "https://attacker.example/cb" });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_grant" });
  });

  it("refuses an authorization code it never issued", async () => {
    const response = await exchange("f".repeat(64));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_grant" });
  });
});

describe("code redemption", () => {
  it("refuses to spend the same emailed code twice", async () => {
    const session = await startLogin();
    await submitEmail(session, "ada@example.com");
    const code = lastCode();
    expect((await submitCode(session, code)).status).toBe(302);

    // The session is finished, so the replay finds nothing rather than a second success. This is
    // the failure mode the whole Worker was written to avoid producing.
    const replayed = await submitCode(session, code);
    expect(replayed.status).toBe(400);
  });

  it("cancels the code after the configured number of wrong attempts", async () => {
    const session = await startLogin();
    await submitEmail(session, "ada@example.com");
    const code = lastCode();
    const wrong = code === "000000" ? "111111" : "000000";

    // IDP_MAX_ATTEMPTS is 3 in the test environment.
    expect(await (await submitCode(session, wrong)).text()).toContain("2 attempts left");
    expect(await (await submitCode(session, wrong)).text()).toContain("One more attempt");
    expect(await (await submitCode(session, wrong)).text()).toContain("Too many incorrect attempts");

    // Even the right code is gone now, so a patient guesser cannot finish what they started.
    const response = await submitCode(session, code);
    expect(await response.text()).toContain("not valid");
  });

  it("does not spend an attempt on something that is not code-shaped", async () => {
    const session = await startLogin();
    await submitEmail(session, "ada@example.com");
    const code = lastCode();

    for (const typo of ["12345", "abcdef", ""]) {
      expect(await (await submitCode(session, typo)).text()).toContain("6-digit code");
    }
    // All three attempts survive, because none of those could have been a guess.
    expect((await submitCode(session, code)).status).toBe(302);
  });

  it("invalidates the previous code when a new one is sent", async () => {
    const session = await startLogin();
    await submitEmail(session, "ada@example.com");
    const first = lastCode();
    await submitEmail(session, "ada@example.com");
    expect(sent).toHaveLength(2);

    expect(await (await submitCode(session, first)).text()).toContain("not correct");
    expect((await submitCode(session, lastCode())).status).toBe(302);
  });
});

describe("who may be sent a code", () => {
  it("mails an address on an allowed domain", async () => {
    await submitEmail(await startLogin(), "anyone@example.com");
    expect(sent).toHaveLength(1);
  });

  it("mails an individually allowed address outside those domains", async () => {
    await submitEmail(await startLogin(), "allowed@other.test");
    expect(sent).toHaveLength(1);
  });

  it("sends nothing to an address outside the allowlist", async () => {
    await submitEmail(await startLogin(), "stranger@elsewhere.test");
    expect(sent).toHaveLength(0);
  });

  it("does not reveal whether an address was allowed", async () => {
    // Both land on the same page. Otherwise this endpoint answers "does this person have access
    // here?" for anyone willing to ask, which is a directory of the deployment's users.
    const page = async (email: string) => (await (await submitEmail(await startLogin(), email))
      .text())
      // The session token and the address differ by construction; everything else must not.
      .replace(/value="[\da-f]{64}"/g, 'value="SESSION"')
      .replaceAll(email, "ADDRESS");

    expect(await page("stranger@elsewhere.test")).toBe(await page("ada@example.com"));
  });

  it("rejects an address that is not an address at all", async () => {
    const response = await submitEmail(await startLogin(), "not-an-address");

    expect(await response.text()).toContain("valid email address");
    expect(sent).toHaveLength(0);
  });

  it("stops sending once one login has asked for too many codes", async () => {
    const session = await startLogin();
    // IDP_MAX_SENDS_PER_SESSION is 3 in the test environment.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await submitEmail(session, "ada@example.com");
    }
    expect(sent).toHaveLength(3);
  });

  it("stops sending once one address has had too many codes across logins", async () => {
    // IDP_MAX_SENDS_PER_EMAIL is 4 in the test environment, and a fresh session each time is
    // exactly how a script would try to get around the per-session limit.
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await submitEmail(await startLogin(), "throttled@example.com");
    }
    expect(sent).toHaveLength(4);
  });
});

describe("the OIDC request", () => {
  it("refuses an unknown client without redirecting anywhere", async () => {
    const response = await SELF.fetch(authorizeUrl({ client_id: "someone-else" }));

    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
  });

  it("refuses an unregistered redirect_uri without redirecting to it", async () => {
    // The open-redirect case, and worse: bouncing to an unvalidated redirect_uri would hand an
    // authorization code to whoever supplied it.
    const response = await SELF.fetch(
      authorizeUrl({ redirect_uri: "https://attacker.example/callback" }),
      { redirect: "manual" });

    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
  });

  it("reports an unsupported response_type to the registered callback", async () => {
    const response = await SELF.fetch(
      authorizeUrl({ response_type: "token" }), { redirect: "manual" });

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location")!);
    expect(location.searchParams.get("error")).toBe("unsupported_response_type");
    expect(location.searchParams.get("state")).toBe("state-value");
  });

  it("refuses a submission carrying a session it never issued", async () => {
    const response = await submitEmail("0".repeat(64), "ada@example.com");

    expect(response.status).toBe(400);
    expect(sent).toHaveLength(0);
  });
});

describe("the discovery document", () => {
  it("advertises endpoints under the configured issuer", async () => {
    const response = await SELF.fetch(`${ISSUER}/.well-known/openid-configuration`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/authorize`,
      token_endpoint: `${ISSUER}/token`,
      jwks_uri: `${ISSUER}/jwks`,
      id_token_signing_alg_values_supported: ["RS256"],
    });
  });

  it("publishes a public key and keeps the private half to itself", async () => {
    const { keys } = await (await SELF.fetch(`${ISSUER}/jwks`)).json() as
      { keys: (JsonWebKey & { kid: string })[] };

    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({ kty: "RSA", use: "sig", alg: "RS256" });
    expect(keys[0]!.kid).toBeTruthy();
    // `d` is the private exponent. Publishing it would hand out the ability to mint identities.
    expect(keys[0]).not.toHaveProperty("d");
  });

  it("serves the same key across requests rather than minting one per isolate", async () => {
    const read = async () => ((await (await SELF.fetch(`${ISSUER}/jwks`)).json()) as
      { keys: { kid: string }[] }).keys[0]!.kid;

    expect(await read()).toBe(await read());
  });
});

describe("userinfo", () => {
  it("returns the address for a token this Worker issued", async () => {
    const { access_token: accessToken } =
      await (await exchange(await signIn())).json() as { access_token: string };

    const response = await SELF.fetch(`${ISSUER}/userinfo`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      email: "ada@example.com",
      email_verified: true,
    });
  });

  it("refuses a missing or forged token", async () => {
    expect((await SELF.fetch(`${ISSUER}/userinfo`)).status).toBe(401);
    expect((await SELF.fetch(`${ISSUER}/userinfo`, {
      headers: { authorization: "Bearer not.a.token" },
    })).status).toBe(401);
  });

  it("refuses an id_token presented as an access token", async () => {
    // Different audiences, so a token meant for Access cannot be replayed at this endpoint.
    const { id_token: idToken } =
      await (await exchange(await signIn())).json() as { id_token: string };

    const response = await SELF.fetch(`${ISSUER}/userinfo`, {
      headers: { authorization: `Bearer ${idToken}` },
    });

    expect(response.status).toBe(401);
  });
});
