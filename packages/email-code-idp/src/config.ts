// The Worker's settings, read once per request from `env` and checked rather than trusted.
//
// Everything here arrives as a string, because that is what `vars` and secrets are. A misparsed
// number becomes `NaN`, and `NaN` comparisons are all false -- which turns a limit into no limit at
// all. So each value is parsed and rejected loudly here rather than compared hopefully later.

import { normalizeEmail } from "./code.js";

export interface IdpConfig {
  /** This Worker's own public origin. Becomes the `iss` claim and the base of every endpoint. */
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** The single callback this provider will redirect to, matched exactly. */
  redirectUri: string;
  /** What the sign-in page and the email call this deployment. */
  brand: string;
  mailFrom: string;
  mailApiKey: string;
  /** Exact addresses that may receive a code. */
  allowedEmails: ReadonlySet<string>;
  /** Domains, lower-cased and without the `@`, whose every address may receive a code. */
  allowedDomains: ReadonlySet<string>;
  /** Whether the allowlist was explicitly opened to any address. */
  allowAnyEmail: boolean;
  codeTtlMs: number;
  maxAttempts: number;
  maxSendsPerSession: number;
  maxSendsPerEmail: number;
  sendWindowMs: number;
}

function required(env: Cloudflare.Env, name: keyof Cloudflare.Env): string {
  const value = env[name];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${String(name)} must be set on the email-code IdP Worker.`);
  }
  return value.trim();
}

function positiveInteger(
  env: Cloudflare.Env, name: keyof Cloudflare.Env, fallback: number, minimum = 1,
): number {
  const raw = env[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(
      `${String(name)} must be a whole number of at least ${minimum}. It arrives as a string, so ` +
      "anything else parses to NaN and becomes a limit that never trips.");
  }
  return value;
}

/**
 * Who may be sent a code.
 *
 * A comma-separated list of exact addresses, `@domain` entries, or the single entry `*`.
 *
 * Required, and required to be explicit. The Access policy in front of the application is what
 * decides who actually gets in, so it is tempting to let this Worker mail anybody and leave the
 * decision downstream. But a public endpoint that mails a code to any address on request is a
 * mail cannon pointed at strangers and a bill pointed at the operator, and neither shows up in an
 * Access log. `*` remains available for a deployment that genuinely wants open sign-up; it just
 * has to be said out loud.
 */
function parseAllowList(value: string): Pick<
  IdpConfig, "allowedEmails" | "allowedDomains" | "allowAnyEmail"
> {
  const entries = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (!entries.length) {
    throw new Error(
      "IDP_ALLOWED_EMAILS must list who may be sent a sign-in code: exact addresses, @domain " +
      "entries, or * for any address.");
  }
  if (entries.includes("*")) {
    if (entries.length > 1) {
      throw new Error("IDP_ALLOWED_EMAILS is either * or a list, not both.");
    }
    return { allowedEmails: new Set(), allowedDomains: new Set(), allowAnyEmail: true };
  }
  const allowedEmails = new Set<string>();
  const allowedDomains = new Set<string>();
  for (const entry of entries) {
    if (entry.startsWith("@")) {
      allowedDomains.add(entry.slice(1).toLowerCase());
      continue;
    }
    if (!entry.includes("@")) {
      throw new Error(
        `IDP_ALLOWED_EMAILS entry ${JSON.stringify(entry)} is neither an address nor an @domain. ` +
        "A bare domain would silently match nothing.");
    }
    allowedEmails.add(normalizeEmail(entry));
  }
  return { allowedEmails, allowedDomains, allowAnyEmail: false };
}

/** Whether `email`, already normalized, is one this deployment will mail a code to. */
export function isAllowedEmail(email: string, config: IdpConfig): boolean {
  if (config.allowAnyEmail) return true;
  if (config.allowedEmails.has(email)) return true;
  const domain = email.slice(email.lastIndexOf("@") + 1);
  return config.allowedDomains.has(domain);
}

export function readConfig(env: Cloudflare.Env): IdpConfig {
  const issuer = required(env, "IDP_ISSUER").replace(/\/$/, "");
  if (new URL(issuer).origin !== issuer) {
    throw new Error("IDP_ISSUER must be an origin only, with no path and no trailing slash.");
  }
  const brand = required(env, "IDP_BRAND");
  // The brand reaches the email body, and the email body must stay free of anything fetchable.
  // Caught here so it fails at the first request rather than at the first send.
  if (/https?:\/\/|\bwww\./i.test(brand)) {
    throw new Error(
      "IDP_BRAND must not contain a URL: it is rendered into the sign-in email, which carries no " +
      "links by design.");
  }
  return {
    issuer,
    brand,
    clientId: required(env, "IDP_CLIENT_ID"),
    clientSecret: required(env, "IDP_CLIENT_SECRET"),
    redirectUri: required(env, "IDP_REDIRECT_URI"),
    mailFrom: required(env, "IDP_MAIL_FROM"),
    mailApiKey: required(env, "IDP_MAIL_API_KEY"),
    ...parseAllowList(required(env, "IDP_ALLOWED_EMAILS")),
    codeTtlMs: positiveInteger(env, "IDP_CODE_TTL_SECONDS", 600, 60) * 1000,
    maxAttempts: positiveInteger(env, "IDP_MAX_ATTEMPTS", 5),
    maxSendsPerSession: positiveInteger(env, "IDP_MAX_SENDS_PER_SESSION", 3),
    maxSendsPerEmail: positiveInteger(env, "IDP_MAX_SENDS_PER_EMAIL", 5),
    sendWindowMs: positiveInteger(env, "IDP_SEND_WINDOW_SECONDS", 3600, 60) * 1000,
  };
}
