// An OpenID Connect provider that signs people in with a code emailed to them, and mails nothing
// else -- no link, no button, no tracking pixel.
//
// It exists to sit where Cloudflare's own one-time PIN provider sat. That one mails a code and a
// sign-in link that share a single use, so mail security link scanning spends the code on delivery
// and the recipient is told it was already used. Access cannot be configured out of that, because
// the mail is Cloudflare's. Replacing the provider is the part a deployment owns.
//
// Nothing else about the deployment changes. Access still fronts the application, the router still
// owns the public origin, and the Workshop still trusts the same signed Access JWT for the same
// `email` claim. Only the thing Access asks "who is this?" is different, and it lives here.
//
// This Worker takes a public route of its own and is deliberately *not* behind Access: it is what
// Access sends unauthenticated browsers to. See README.md for the trust boundary that follows from
// that.

import { handleRequest } from "./oidc.js";

export { AuthCode, EmailThrottle, LoginSession, SigningKey } from "./store.js";

export default {
  fetch(request, env, ctx) {
    return handleRequest(request, env, ctx);
  },
} satisfies ExportedHandler<Cloudflare.Env>;
