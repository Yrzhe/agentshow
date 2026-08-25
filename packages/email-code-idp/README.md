# Email-code identity provider

An OpenID Connect provider that signs people in with a code emailed to them, and puts nothing else
in that email. No link, no button, no tracking pixel.

## Why this exists

Cloudflare Access's [one-time PIN](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/)
provider mails a code **and** a sign-in link, and the two share a single use. Mail security link
scanning fetches every link in incoming mail, which spends the code on delivery — so the person who
then types it is told **This One-Time PIN has already been used**, on the first try, every time.

Cloudflare documents the fix as allowlisting `noreply@notify.cloudflare.com` in the mail security
product. When that allowlist is not yours to change, there is no second option on Cloudflare's side:
the email is theirs and its template is not configurable.

This Worker is the way to keep emailed codes anyway. It replaces the *provider*, not the
architecture: Access still fronts the application, the router still owns the public origin, and the
Workshop still trusts the same signed Access JWT carrying the same `email` claim. Only the thing
Access asks "who is this?" changes.

The property it sells is narrow and worth stating exactly:

> The email contains a code and no link.

A scanner spends links. It has nothing to spend in bare digits. `assertNoLinks` in `src/email.ts`
enforces this at render time and again before delivery, and `__tests__/email.test.ts` is the
regression test — a "having trouble? click here" added later fails the build rather than quietly
reintroducing the bug it was written to remove.

## Trust boundary

**This Worker is deliberately not behind Access.** It is what Access sends unauthenticated browsers
to, so it cannot be, and it takes a public route of its own rather than sitting behind the router.
Consequences worth holding in mind:

- Its `/authorize` endpoint is reachable by anyone. That is why `IDP_ALLOWED_EMAILS` is required
  rather than defaulted: without it, a public endpoint would mail a code to any address on request.
- It never sees application data. It holds no user table — a login leaves behind nothing but an
  expired Durable Object — and its only output is a signed assertion that one address received one
  code.
- It is not a general-purpose IdP. It serves exactly one client, one redirect URI, and one grant
  type, and refuses everything else. Narrowness is the point.
- Its signing key is generated inside a Durable Object on first use and never leaves it. Nothing
  outside this Worker needs the private half, so nothing outside it has one to leak.

## Endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /.well-known/openid-configuration` | Discovery, so the integration can be checked without reading the source |
| `GET /authorize` | Validates the OIDC request, then asks for an address and a code |
| `POST /authorize/email` | Mints a code and mails it |
| `POST /authorize/code` | Spends an attempt; on success hands the browser back to Access with an authorization code |
| `POST /token` | Exchanges that single-use code for an `id_token` carrying `email` |
| `GET /userinfo` | The same claims again, for verifiers that ask separately |
| `GET /jwks` | The public half of the signing key |

## Why the last step is a page and not a redirect

A correct code ends with a small **Signing you in** page whose `refresh` meta carries the browser to
the Access callback. The obvious shape — answer the form post with a `302` — is the one shape that
cannot be used here, and the reason is worth writing down, because getting it wrong produces the
most confusing failure this Worker can produce.

Chrome and Safari check **every hop** of a form submission's redirect chain against the submitting
page's `form-action`. This hop leaves the origin twice: to the Access callback, and from there to the
application. Listing the callback is not enough, and the second origin is the application's, which
this Worker does not know. So under `form-action 'self'` a `302` here is refused *after* the code has
been spent: no error is shown, the browser stays on the code page, and the person in front of it
does the only sensible thing and presses **Sign in** again — which now reports a code that is not
valid, because it was already redeemed by the tap that appeared to do nothing. Firefox follows the
redirect, and so does `curl`, which is what makes it look like a phone problem.

A `refresh` meta is not a form submission, so `form-action` never applies and the rest of the Access
chain runs. The visible link under it is the same navigation by hand.

The same shape has a second consequence worth knowing. These pages are served with
`referrer-policy: no-referrer`, and a browser hides the origin of a non-GET navigation from such a
page, so **every** submission from the sign-in page arrives as `Origin: null`. Refusing a null origin
therefore refuses every browser while letting `curl` through. `/authorize/email` and
`/authorize/code` refuse only a *named* other origin; the session token, which only ever exists in
the page the visitor is looking at, is what actually keeps them from answering to anybody else.

A correct code should produce exactly this chain, and it is the quickest way to tell the hop is
healthy:

```
POST /authorize/code                     -> 200, "Signing you in"
GET  <team>.cloudflareaccess.com/cdn-cgi/access/callback?code=...&state=...  -> 302
GET  <the application>                   -> 200, signed in
```

## What makes a code single-use

Every record lives in a Durable Object rather than KV. KV reads are eventually consistent, so two
requests carrying the same code could both read it as unspent — and a code that can be redeemed
twice under a race is not single-use, which is the exact failure this Worker was written to stop
producing. In a Durable Object the read and the delete that consumes it happen in one actor turn.

On top of that:

- Codes are stored as a digest salted with the session id, never in the clear.
- A correct code is deleted before the response is built.
- Wrong entries are limited (`IDP_MAX_ATTEMPTS`), and the code is burned when they run out.
- Something that is not code-shaped does not cost an attempt — a typo should not spend a guess.
- Requesting a new code invalidates the previous one.
- Sends are limited per login (`IDP_MAX_SENDS_PER_SESSION`) and per address
  (`IDP_MAX_SENDS_PER_EMAIL` over `IDP_SEND_WINDOW_SECONDS`), so neither a resend button nor a
  script looping over fresh sessions becomes a mail cannon pointed at somebody's inbox.
- The page after submitting an address is identical whether or not a code was sent, so the endpoint
  cannot be used to enumerate who has access.

## Configuration

`scripts/deploy.ts` writes every `var` below from the `emailCodeIdp` block in `deployment.jsonc`.
The two secrets are never written to a file; install them with `wrangler secret put`.

| Variable | Meaning |
| --- | --- |
| `IDP_ISSUER` | This Worker's own public origin |
| `IDP_BRAND` | What the page and the email call this deployment |
| `IDP_CLIENT_ID` | The client Access authenticates as |
| `IDP_CLIENT_SECRET` | **Secret.** Paired with the client id |
| `IDP_REDIRECT_URI` | The one callback this provider returns to |
| `IDP_ALLOWED_EMAILS` | Who may be sent a code: addresses, `@domain` entries, or `*` |
| `IDP_MAIL_FROM` | Envelope sender for the code email |
| `IDP_MAIL_API_KEY` | **Secret.** The delivery provider's API key |
| `IDP_CODE_TTL_SECONDS` | How long a code lasts. Default 600 |
| `IDP_MAX_ATTEMPTS` | Wrong entries before a code is cancelled. Default 5 |
| `IDP_MAX_SENDS_PER_SESSION` | Codes one login may ask for. Default 3 |
| `IDP_MAX_SENDS_PER_EMAIL` | Codes one address may be sent per window. Default 5 |
| `IDP_SEND_WINDOW_SECONDS` | The window that limit counts over. Default 3600 |

Delivery goes through [Resend](https://resend.com). Cloudflare Email Routing cannot be used here:
its `send_email` binding only delivers to addresses already verified in the account, which is the
opposite of what a sign-in provider needs.

## Setting it up

See [Email codes without the allowlist](../../docs/customization.md#email-codes-without-the-allowlist)
for the deployment-level walkthrough, including the two risks worth checking before you switch a
deployment that already has users: the `email` claim has to keep matching existing accounts and
`access.admins`, and narrowing an Access application to a provider nobody has signed in through yet
is a lockout that `access.admins` cannot undo.
