// The two pages a person actually sees, and the error page for when the flow cannot continue.
//
// Self-contained on purpose: no stylesheet, script, font, or image is fetched from anywhere. A
// sign-in page is the one page that must render on a locked-down network, and the styling it needs
// is small enough to inline.

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const STYLE = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  background: #f5f5f7; color: #1d1d1f;
}
main {
  width: 100%; max-width: 380px; background: #fff; border-radius: 14px; padding: 32px;
  box-shadow: 0 1px 3px rgba(0,0,0,.08), 0 8px 24px rgba(0,0,0,.06);
}
h1 { font-size: 20px; line-height: 1.3; margin: 0 0 8px; }
p { font-size: 14px; line-height: 1.5; color: #6e6e73; margin: 0 0 20px; }
label { display: block; font-size: 13px; font-weight: 600; margin: 0 0 6px; }
input {
  width: 100%; font: inherit; padding: 11px 12px; border: 1px solid #d2d2d7; border-radius: 9px;
  background: #fff; color: inherit;
}
input:focus-visible { outline: 2px solid #0071e3; outline-offset: 1px; border-color: #0071e3; }
input.code { font-size: 26px; letter-spacing: .34em; text-align: center; padding: 12px; }
button {
  width: 100%; font: inherit; font-weight: 600; margin-top: 16px; padding: 11px 12px;
  border: 0; border-radius: 9px; background: #0071e3; color: #fff; cursor: pointer;
}
button:hover { background: #0077ed; }
button.secondary { background: transparent; color: #0071e3; margin-top: 8px; font-weight: 500; }
button.secondary:hover { background: rgba(0,113,227,.08); }
.error {
  font-size: 13px; color: #b3261e; background: #fdeceb; border-radius: 8px; padding: 10px 12px;
  margin: 0 0 16px;
}
.sent { font-size: 13px; color: #1d1d1f; margin: 0 0 20px; }
.sent strong { font-weight: 600; }
@media (prefers-color-scheme: dark) {
  body { background: #000; color: #f5f5f7; }
  main { background: #1c1c1e; box-shadow: none; }
  p { color: #98989d; }
  input { background: #2c2c2e; border-color: #3a3a3c; }
  .error { background: #3b1513; color: #ff6961; }
  .sent strong { color: #f5f5f7; }
}
`.trim();

function layout(title: string, body: string, head = ""): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
${head}<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body><main>${body}</main></body>
</html>`;
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      // A sign-in page has no business being framed, cached, or leaking its URL onward.
      "cache-control": "no-store",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
    },
  });
}

function errorBlock(error: string | null): string {
  return error ? `<p class="error">${escapeHtml(error)}</p>` : "";
}

/** Step one: which address should the code go to. */
export function emailPage(
  options: { brand: string; session: string; email?: string; error?: string | null },
): Response {
  const { brand, session, email = "", error = null } = options;
  return layout(`Sign in to ${brand}`, `
<h1>Sign in to ${escapeHtml(brand)}</h1>
<p>Enter your email address and we will send you a sign-in code.</p>
${errorBlock(error)}
<form method="post" action="/authorize/email">
  <input type="hidden" name="session" value="${escapeHtml(session)}">
  <label for="email">Email address</label>
  <input id="email" name="email" type="email" autocomplete="email" inputmode="email"
         required autofocus value="${escapeHtml(email)}">
  <button type="submit">Send code</button>
</form>`);
}

/**
 * Step two: the code itself.
 *
 * `autocomplete="one-time-code"` is what lets iOS and Android offer the code from the notification,
 * which matters more here than usual: the whole point of this provider is that the mail has no link
 * to tap, so typing is the only path and it should be as short as possible.
 *
 * The dash in `pattern` is escaped because a `pattern` attribute is compiled as a unicode-sets
 * regular expression, in which `\s-]` is a syntax error rather than a literal dash. A browser
 * discards a pattern it cannot compile, so the unescaped version silently stopped catching a pasted
 * word here and left the server to say so instead.
 */
export function codePage(
  options: {
    brand: string;
    session: string;
    email: string;
    digits: number;
    error?: string | null;
    canResend: boolean;
  },
): Response {
  const { brand, session, email, digits, error = null, canResend } = options;
  return layout(`Enter your ${brand} code`, `
<h1>Enter your code</h1>
<p class="sent">We sent a code to <strong>${escapeHtml(email)}</strong>. It expires shortly and can
be used once.</p>
${errorBlock(error)}
<form method="post" action="/authorize/code">
  <input type="hidden" name="session" value="${escapeHtml(session)}">
  <label for="code">${digits}-digit code</label>
  <input id="code" name="code" class="code" type="text" inputmode="numeric"
         autocomplete="one-time-code" pattern="[0-9\\s\\-]*" maxlength="${digits + 6}"
         required autofocus>
  <button type="submit">Sign in</button>
</form>
${canResend ? `<form method="post" action="/authorize/email">
  <input type="hidden" name="session" value="${escapeHtml(session)}">
  <input type="hidden" name="email" value="${escapeHtml(email)}">
  <button type="submit" class="secondary">Send a new code</button>
</form>` : ""}`);
}

/**
 * Step three: hand the browser back to Access.
 *
 * A page rather than the `302` this obviously wants to be, because the response to a form
 * submission is the one place a redirect cannot be relied on. Chrome and Safari check every hop of
 * a form submission's redirect chain against the submitting page's `form-action`, and this hop
 * leaves the origin twice: to the Access callback, and from there to the application. Listing those
 * origins is not a fix either -- the second one is the application's, which this Worker does not
 * know and has no business knowing. So a `302` here is refused by the browser *after* the code has
 * been spent, which puts the visitor back on the code page with no error, a code that is now used
 * up, and every reason to press the button again. Firefox follows it and so does curl, which is what
 * makes the result look like a phone problem rather than a redirect problem.
 *
 * A `refresh` meta is not a form submission, so `form-action` never applies to it and the rest of
 * the Access chain runs. The link below it is the same navigation by hand, for anything that ignores
 * the meta.
 */
export function continuePage(options: { brand: string; url: string }): Response {
  const url = escapeHtml(options.url);
  const brand = escapeHtml(options.brand);
  return layout(`Signing in to ${options.brand}`, `
<h1>Signing you in</h1>
<p>Taking you to ${brand}. If nothing happens, <a href="${url}">continue to ${brand}</a>.</p>`,
  `<meta http-equiv="refresh" content="0; url=${url}">\n`);
}

/**
 * The dead end.
 *
 * Deliberately offers no "try again" link: at this point the Worker no longer holds a valid OIDC
 * request, and the only correct restart is the application sending the user through Access again.
 */
export function errorPage(options: { brand: string; message: string; status?: number }): Response {
  const response = layout(`Cannot sign in to ${options.brand}`, `
<h1>Cannot sign in</h1>
<p>${escapeHtml(options.message)}</p>
<p>Close this tab and open ${escapeHtml(options.brand)} again to start over.</p>`);
  return new Response(response.body, { status: options.status ?? 400, headers: response.headers });
}
