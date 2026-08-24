// Project-specific Env/ctx.exports augmentation for Wrangler's generated types.

declare namespace Cloudflare {
  interface Env {
    /** This Worker's own public origin, with no path and no trailing slash. */
    IDP_ISSUER: string;
    /** What the sign-in page and the emailed code call this deployment. */
    IDP_BRAND: string;
    /** The client Access authenticates as. */
    IDP_CLIENT_ID: string;
    /** Secret. Installed with `wrangler secret put`, never in a tracked file. */
    IDP_CLIENT_SECRET: string;
    /** The one callback this provider will return to: the Access team's OIDC callback. */
    IDP_REDIRECT_URI: string;
    /** Who may be sent a code: addresses, `@domain` entries, or the single entry `*`. */
    IDP_ALLOWED_EMAILS: string;
    /** Envelope sender for the code email, as the delivery provider expects it. */
    IDP_MAIL_FROM: string;
    /** Secret. The delivery provider's API key. */
    IDP_MAIL_API_KEY: string;
    /** How long an emailed code stays valid. Default 600. */
    IDP_CODE_TTL_SECONDS?: string;
    /** Wrong entries before a code is cancelled. Default 5. */
    IDP_MAX_ATTEMPTS?: string;
    /** Codes one login attempt may ask for. Default 3. */
    IDP_MAX_SENDS_PER_SESSION?: string;
    /** Codes one address may be sent per window. Default 5. */
    IDP_MAX_SENDS_PER_EMAIL?: string;
    /** The window the per-address limit counts over. Default 3600. */
    IDP_SEND_WINDOW_SECONDS?: string;
  }

  interface GlobalProps {
    // Populates Cloudflare.Exports, the type of ctx.exports.
    mainModule: typeof import("./index.js");
    // Storage classes exposed as DO namespaces on ctx.exports.
    durableNamespaces: "LoginSession" | "AuthCode" | "EmailThrottle" | "SigningKey";
  }
}
