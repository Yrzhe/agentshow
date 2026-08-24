// The message that carries the code, and the guard that keeps a link out of it.
//
// This file is the entire reason this Worker exists. Cloudflare's own one-time PIN mail carries a
// code *and* a sign-in link that share a single use, so mail security link scanning spends the PIN
// on delivery and the person who then types the code is told it was already used. Nothing about
// that is a defect in the code path -- it is a link in an inbox that something else is allowed to
// fetch.
//
// So the property this Worker sells is narrow and absolute: the mail it sends contains a code and
// no link. `assertNoLinks` enforces it at render time rather than trusting the template to stay
// that way, because a helpful "having trouble? click here" added later would reintroduce the exact
// bug this replaced, and would do it silently.

/** A rendered message, ready to hand to a delivery API. */
export interface CodeMessage {
  subject: string;
  text: string;
  html: string;
}

/**
 * Anything a scanner, a preview fetcher, or a client's auto-linkifier could turn into a request.
 *
 * Bare hostnames (`www.` and the like) are included even though they carry no scheme, because mail
 * clients linkify them and the resulting fetch is indistinguishable from following a real link.
 */
const LINK_PATTERN = /<a[\s>]|href\s*=|src\s*=|https?:\/\/|\bwww\.|\bmailto:/i;

/**
 * Throws unless every part of `message` is free of anything fetchable.
 *
 * Deliberately a hard failure rather than a sanitiser. Stripping a link would let a template that
 * wants one keep shipping while quietly losing it; refusing to send makes the person who added it
 * read this comment.
 */
export function assertNoLinks(message: CodeMessage): void {
  for (const part of ["subject", "text", "html"] as const) {
    const match = LINK_PATTERN.exec(message[part]);
    if (match) {
      throw new Error(
        `Refusing to send a sign-in code: the ${part} contains ${JSON.stringify(match[0])}, which ` +
        "is fetchable. A code emailed alongside anything a link scanner can follow is a code that " +
        "gets spent before the recipient types it, which is the failure this Worker exists to " +
        "avoid. Keep the message to the code itself.");
    }
  }
}

/**
 * The sign-in mail for one code.
 *
 * Plain text and HTML say the same thing; the HTML exists so the digits can be big enough to read
 * on a phone, and carries no stylesheet, no image, and no remote font for the same reason it
 * carries no link.
 */
export function renderCodeMessage(
  options: { brand: string; code: string; ttlMinutes: number },
): CodeMessage {
  const { brand, code, ttlMinutes } = options;
  const minutes = ttlMinutes === 1 ? "1 minute" : `${ttlMinutes} minutes`;
  const message: CodeMessage = {
    subject: `${code} is your ${brand} sign-in code`,
    text: [
      `Your ${brand} sign-in code is:`,
      "",
      `    ${code}`,
      "",
      `It expires in ${minutes} and can be used once.`,
      "Type it into the sign-in page you already have open.",
      "",
      "If you did not ask to sign in, you can ignore this message.",
      "Nobody can use this code without also having your open sign-in page.",
    ].join("\n"),
    html: [
      `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;`,
      `font-size:16px;line-height:1.5;color:#1d1d1f">`,
      `<p>Your ${escapeHtml(brand)} sign-in code is:</p>`,
      `<p style="font-size:34px;font-weight:600;letter-spacing:.18em;margin:24px 0">`,
      `${escapeHtml(code)}</p>`,
      `<p>It expires in ${minutes} and can be used once. `,
      `Type it into the sign-in page you already have open.</p>`,
      `<p style="color:#6e6e73;font-size:14px">If you did not ask to sign in, you can ignore this `,
      `message. Nobody can use this code without also having your open sign-in page.</p>`,
      `</div>`,
    ].join(""),
  };
  assertNoLinks(message);
  return message;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** How a rendered message reaches an inbox. Injected so the flow can be tested without network. */
export type EmailSender = (to: string, message: CodeMessage) => Promise<void>;

/** Delivery through Resend's REST API. */
export function resendSender(options: { apiKey: string; from: string }): EmailSender {
  return async (to, message) => {
    // Re-checked at the boundary as well as at render time: this is the last point before the
    // bytes leave the Worker, and it is the only check that also covers a message built elsewhere.
    assertNoLinks(message);
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: options.from,
        to: [to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
    });
    if (!response.ok) {
      // The body can name the address, so it is summarised rather than logged whole.
      throw new Error(`Sign-in code delivery failed with status ${response.status}.`);
    }
  };
}
