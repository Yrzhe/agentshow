# Customizing Cloudflare OS

This wrapper exposes controls at three depths. Start in the Admin UI, move to deployment configuration when the trust or infrastructure boundary changes, and write code only for capabilities that neither layer can express.

## Admin UI

Use `/admin` for runtime policy that should not require a deployment:

- Site name, logo, and accent color
- Announcements and agent instructions
- Connector availability and auto-provisioning policy
- Signup behavior, featured blueprints, and output formats

Authentication and authorization are deliberately absent. Sign-in configuration and administrator identities remain deployment-controlled so a compromised admin session cannot redefine the trust boundary.

### Branding

Set the site name, logo, and accent color from the General tab in `/admin`. Logo uploads accept PNG, JPEG, WebP, and SVG files up to 5 MB. The browser scales the longest edge to 256 pixels without cropping and converts the result to PNG. The server then checks the PNG header and rejects anything over 256 KB or 512 pixels before storing it in the deployment's blueprint-content R2 bucket. Square images work best.

The custom logo appears in the app chrome, sign-in screens, and browser tab on each user's next connection. Use **Restore default** to remove it.

## Deployment configuration

[`deployment.jsonc`](../deployment.jsonc) is an annotated, non-secret control surface. Its groups map directly to generated Wrangler configuration:

| Path | Controls | Choices |
| --- | --- | --- |
| `accountId` | Resource ownership | A 32-character [Cloudflare account ID](https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/) |
| `publicBaseUrl` | The deployment's public origin | `null` to derive it from the router's custom domain; on a `workers.dev` route, the router's own `https://<router-name>.<subdomain>.workers.dev` |
| `workers.*.name` | Stable Worker service identities | Unique lowercase names; changing one creates a differently named Worker |
| `workers.router.route` | The deployment's public address | `customDomain` for production or `workersDev: true` for evaluation |
| `access` | Cloudflare Access trust and administrator list | Access team issuer, application audience, and verified email list |
| `aiGateway` | Deployment-managed model catalog | Enabled by default over the Workers AI binding; which providers to advertise, and which gateway |
| `context` | Context sharing boundary, snapshot KV, and optional Artifacts repositories | `null` to scope data to the public origin, or a pinned stable label; automatic or existing KV; Git-backed collections disabled or enabled |
| `project` | Project sharing boundary, the R2 bucket holding file and widget bytes, and per-project quotas | `null` to scope projects to the public origin, or a pinned stable label; automatic or existing bucket; see the [collaboration design](collaboration.md) |
| `customGatekeeper` | Example integration identity and guidance | Organization-specific display text |
| `errorReporting` | Private explicit-issue destination | Console Reporter enabled state, environment, and release metadata |
| `resources` | Blueprint/avatar KV and blueprint-content R2 | `null` to provision or explicit IDs/names to reuse |
| `observability` | Worker telemetry | Structured logs, invocation logs, traces, and sampling; see the [observability guide](observability.md) |

Secrets are never valid values in this file. Install them interactively with Wrangler against the Worker that consumes them.

### Workers and routing

The deployment is seven Workers, or eight with the optional [email-code sign-in provider](#email-codes-without-the-allowlist). Keep their names unique: service bindings use these names, so update and deploy them together.

| Worker | Role |
| --- | --- |
| `router` | Owns the public route and serves the frontend. Proxies `/api` and `/blueprint-screenshot` to the Workshop, and `/gatekeeper/<name>` to the Gatekeeper whose service binding matches. |
| `workshop` | The Cloudflare OS backend, holding all user data in Durable Objects. |
| `context` | The Context Gatekeeper. |
| `scheduler` | The Scheduler Gatekeeper, which gives agents scheduled and recurring work. |
| `project` | The Project Gatekeeper: shared files, comments, skills, settings and widgets for a team whose members each keep their own chats. Widgets serve their files and persist data through a built-in `api/store` with no account feature required; letting one run a `backend.js` of its own is `project.widgetBackends`, which adds a Worker Loader binding and so needs [Dynamic Worker Loaders](https://developers.cloudflare.com/workers/runtime-apis/bindings/worker-loader/) on the account. See the [collaboration design](collaboration.md). |
| `customGatekeeper` | This repository's example integration. |
| `errorReporter` | The private explicit-issue destination. |

Context and Scheduler are *ambient*: upstream's release marks both `PREINSTALL`, so the hosted flow installs them on every instance and this starter deploys them for the same reason. Neither takes configuration beyond its name — the Scheduler takes none at all. The Project Gatekeeper is ambient in the same way, but it is ours rather than upstream's, and it does take configuration: a sharing boundary, a bucket for file bytes, and per-project quotas.

Only the router takes a route; the other six are reachable only over service bindings, and the deploy turns off `workers.dev` and [Preview URLs](https://developers.cloudflare.com/workers/configuration/previews/) on all seven. That keeps the router the single Access-protected way in.

For production, set a [Custom Domain](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) on it:

```jsonc
"workers": { "router": { "name": "acme-os", "route": { "customDomain": "os.example.com" } } }
```

The hostname must belong to an active Cloudflare zone and cannot conflict with an existing CNAME. Wrangler creates the DNS record and certificate, and `publicBaseUrl` can stay `null` — the deploy derives the public origin from the domain. For evaluation, use the account's [`workers.dev`](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/) subdomain instead:

```jsonc
"publicBaseUrl": "https://acme-os.<subdomain>.workers.dev",
"workers": { "router": { "name": "acme-os", "route": { "workersDev": true } } }
```

`publicBaseUrl` is required there, because nothing in `deployment.jsonc` knows your account's `workers.dev` subdomain. If using workers.dev that value must be `https://<router-name>.<subdomain>.workers.dev`. Three things read the origin — `PUBLIC_BASE_URL`, which upstream builds absolute links and OAuth redirect URIs from and this starter builds project and file links from, and the Context and project sharing boundaries under [Storage](#storage) — so a typo here would deploy successfully and then hide existing Context collections and every existing project, and break every redirect.

On a custom domain the hostname is yours and has nothing to do with any Worker name, so `pnpm check` compares `publicBaseUrl` against `customDomain` instead: leave it `null` and the deploy derives the origin from the domain, or set it to exactly `https://<customDomain>`.

### Sign-in methods

Cloudflare OS supports three ways to sign users in. This starter deploys Cloudflare Access.

| Method | How it works | In this starter |
| --- | --- | --- |
| Cloudflare Access | Access verifies identity before the request reaches the Worker, and the Workshop trusts the signed Access JWT. The password login and signup pages are disabled. | Deployed by default |
| Built-in password accounts | Cloudflare OS serves its own username and password login plus signup. This is the upstream default. | Requires deploy script changes |
| Auth Gatekeepers | Gatekeepers that advertise `providesAuth` add "Continue with ..." buttons, alongside or instead of password login. | Requires deploy script changes |

Access mode is the default here because unauthenticated requests never reach application code. `scripts/deploy.ts` implements it by setting `CF_ACCESS_ISS` and `CF_ACCESS_AUD` on the Workshop and building the frontend with `VITE_CF_ACCESS_MODE=true`.

To run another method, drop those two variables and the build flag, then set upstream's `AUTH_GATEKEEPERS` allowlist for provider sign-in. `DISABLE_PASSWORD_AUTH=true` makes a deployment provider-only. Upstream ignores it unless at least one auth Gatekeeper is allowlisted, so a deployment cannot lock everyone out. The wrapper's validation assumes Access mode, so review the upstream Workshop backend and frontend documentation before changing it.

The `admins` list gates `/admin` in every method.

#### Cloudflare Access

Create a [self-hosted Access application](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/) covering the router's hostname. Then configure:

- `issuer`: the team origin, such as `https://acme.cloudflareaccess.com`, with no path.
- `audience`: the application's [AUD tag](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/#get-your-aud-tag).
- `admins`: Access-verified email addresses allowed into `/admin`.

Access policies decide who can sign in. The `admins` list decides which signed-in identities can change runtime policy. Keep both narrow.

#### One-time PIN sign-in

The Access application also picks the identity provider, and that choice — not anything in this repository — decides what signing in looks like. A first setup, and every instance migrated from the hosted deploy, normally uses Cloudflare's [one-time PIN](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/) provider, which mails a code from `noreply@notify.cloudflare.com`. The code is single-use, it expires ten minutes after the request, and requesting another one invalidates it.

That email carries both the code and a link that completes the sign-in, and the two share the one use. Anything that fetches the link spends it, which is exactly what mail security link scanning does to incoming mail; so does link preview in some clients. The user then types a code Access has already consumed and gets **This One-Time PIN has already been used** — on the first try, on every attempt, no matter how quickly they type. It looks like an application bug and is not one. Access mints, mails and consumes the PIN before a request reaches the router, so no Worker in this deployment ever sees the code, and there is nothing here to fix in response. It is also why only this sign-in misbehaves for a user whose codes from other services always work: those services mail a bare code, giving a scanner nothing to spend.

The fixes are in the mail path or in the provider:

- Allowlist `noreply@notify.cloudflare.com` in the mail security product, exempting it from link rewriting and scanning. This is the remedy Cloudflare documents, and it is the one to try first.
- Where that allowlist is not yours to change, move the application to a different [identity provider](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/). The audience belongs to the application rather than the provider, so `issuer` and `audience` both survive the switch and the Workshop keeps trusting the same signed JWT. This does not mean giving up codes — see [Email codes without the allowlist](#email-codes-without-the-allowlist).

Both are Access configuration, not deployment configuration. Neither requires a change to `deployment.jsonc` or a `pnpm deploy`.

Swapping the provider does carry one risk worth checking first: a Workshop account is keyed by the email claim in the Access JWT, and `admins` is matched against that same claim. A provider that asserts the same address for a person keeps their account and their admin rights. One that asserts a different address — a corporate alias instead of the primary, say — signs them in as a new and empty user, quietly rather than with an error. Compare the claims the new provider issues against the existing `admins` entries before moving a deployment that already has users.

#### Email codes without the allowlist

The allowlist belongs to whoever runs the mail security product, and often that is not you. Cloudflare's side is fixed too: the one-time PIN email is theirs, and neither the template nor the link inside it is configurable. So when the allowlist is unavailable, that provider cannot be made to work, and nothing in this repository changes that.

Signing in with an emailed code is still available. What has to change is who sends the code, and the property that has to hold is narrower than "a different provider" — it is worth naming exactly:

> The email must contain a code and no link.

A scanner spends links. It has nothing to spend in a bare six digits. That is the whole mechanism, and reading it that way is what keeps the next choice from repeating this one: a provider that mails a magic link, or that mails a code *and* a link as Cloudflare's does, reproduces this failure under a new name. Vendor reputation is not the variable.

So the Access application needs to point at an OIDC provider whose email you control. Any [supported provider](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/) whose passwordless email can be set to send a code rather than a magic link will do, and this repository also ships one, so that a deployment does not have to take on a second vendor to fix a mail problem.

##### The provider in this repository

`packages/email-code-idp` is an OIDC provider that emails a code and nothing else. It replaces the provider, not the architecture: Access still fronts the application, the router still owns the public origin, and the Workshop still trusts the same signed Access JWT carrying the same `email` claim.

It is off by default and should stay off wherever the allowlist is available — Cloudflare's own provider needs no Worker, no delivery account, and no key. Turn it on in `deployment.jsonc`:

```jsonc
"workers": {
  "emailCodeIdp": { "name": "acme-login", "route": { "customDomain": "login.example.com" } }
},
"emailCodeIdp": {
  "enabled": true,
  "issuer": null,
  "brand": "Acme",
  "clientId": "acme-access",
  "allowedEmails": ["@example.com"],
  "mailFrom": "Acme <login@example.com>"
}
```

Then:

1. Install the two secrets, which are never config values: `wrangler secret put IDP_CLIENT_SECRET` and `wrangler secret put IDP_MAIL_API_KEY`, both `--name` the Worker above. Delivery goes through [Resend](https://resend.com); Cloudflare Email Routing cannot do this job, because its `send_email` binding only delivers to addresses already verified in the account.
2. `pnpm check`, then `pnpm deploy`.
3. Add it under **Zero Trust → Integrations → Identity providers** as [generic OIDC](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/generic-oidc/), with the client id and secret from above, the `email` scope, and the endpoints listed at `https://<its hostname>/.well-known/openid-configuration`.
4. Send yourself a test code and read the raw message before going further. It should contain no `<a href` and no tracking URL. The Worker enforces this and its tests assert it, so this is a confirmation rather than a discovery — but it is the property the whole change rests on, and it costs a minute.
5. On the Access application's **Authentication** tab, turn off **Accept all available identity providers** and select only the new one, so nobody is offered the broken option. **Apply instant authentication** then sends users straight there instead of showing the provider chooser.
6. Sign in as an existing non-admin user and as an admin, and confirm the existing chats and `/admin` are both still there. That is what proves the email claim matched, per the caveat above.

`access.issuer`, `access.audience` and `admins` are all untouched: the audience belongs to the application rather than the provider. The provider's own callback is derived from `access.issuer` rather than configured, since the only address it may return to is that team's OIDC callback.

##### Two things to get right

**This Worker takes a public route and is deliberately not behind Access.** It has to be — it is where Access sends browsers that have not signed in yet, so a provider behind the application it authenticates for could never be reached. It therefore needs a hostname of its own, and the deploy refuses one that shares the router's. It reaches no other Worker and no application data; it keeps no user table; a finished login leaves behind an expired Durable Object. `allowedEmails` is required rather than defaulted for the same reason: a public endpoint that mails a code to any address on request is a mail cannon pointed at strangers and a bill pointed at you. `["*"]` is available for deployments that genuinely want open sign-up, and has to be written out.

**Keep a way back in before step 5 removes the old login method.** Narrowing an application to a single provider you have not signed in through yet is how people lock themselves out of their own deployment, and the `admins` list cannot help because reaching `/admin` requires getting through Access first. Verify the new provider in one browser while an authenticated session is still open in another, or leave a second login method enabled until the first real sign-in succeeds.

[`packages/email-code-idp/README.md`](../packages/email-code-idp/README.md) documents the endpoints, the limits on codes and sends, and why single use is enforced in a Durable Object rather than KV.

### Storage

Wrangler supports [automatic provisioning](https://developers.cloudflare.com/workers/wrangler/configuration/#automatic-provisioning) for KV and R2. Leave these values as `null` for a new deployment:

```jsonc
"context": {
  "sharingDomain": null,
  "kvNamespaceId": null
},
"project": {
  "sharingDomain": null,
  "filesBucket": null
},
"resources": {
  "blueprintsKvNamespaceId": null,
  "avatarsKvNamespaceId": null,
  "blueprintContentBucket": null
}
```

Wrangler creates resources with the Worker name as a prefix and reconnects them on future deploys. To adopt existing data, replace the relevant `null` with a [KV namespace ID](https://developers.cloudflare.com/kv/reference/kv-commands/#kv-namespace) or [R2 bucket name](https://developers.cloudflare.com/r2/reference/wrangler-commands/#r2-bucket).

`context.sharingDomain` and `project.sharingDomain` are not storage but data-isolation boundaries: Context collections are visible only within the first, and projects only within the second. `null` scopes each to the deployment's public origin, which is what the hosted deploy does. Changing a boundary hides what was stored under the old one even with the right KV or bucket bound — every existing collection, and every existing project along with its members, comments and files — so pin both to a literal string when a hostname change must not move them:

```jsonc
"context": { "sharingDomain": "https://os.example.com" },
"project": { "sharingDomain": "https://os.example.com" }
```

The hidden data is still there, so setting the boundary back reveals it again. Nothing warns you in between: a project whose boundary moved looks to its members like a project they were never in.

### Context Artifacts

The Context Gatekeeper can use [Artifacts](https://developers.cloudflare.com/artifacts/) as Git-compatible storage for Context collections. This is disabled when `enabled` is omitted or false and requires Artifacts access on the deployment account. Enable it without specifying a namespace to use `gatekeeper-context-collections`:

```jsonc
"artifacts": { "enabled": true }
```

To isolate repositories under another stable namespace, add the optional property:

```jsonc
"artifacts": {
  "enabled": true,
  "namespace": "acme-context-collections"
}
```

Artifacts creates the namespace implicitly when the first repository is created. Keep the selected namespace stable: existing Git-backed collections refer to repositories in it. Disabling the binding later stops repository refresh and token management but does not delete repositories; the last synchronized Context content remains readable. Write tokens grant repository mutation authority, so protect them like other credentials and revoke them when no longer needed.

### AI models

Every provider, Workers AI included, is reached through [AI Gateway](https://developers.cloudflare.com/ai-gateway/). The transport is the Workshop's `WORKERS_AI` binding, which is pre-authenticated inside your own account — so the default configuration needs **no API token at all**:

```jsonc
"aiGateway": {
  "enabled": true,
  "name": "default",
  "accountId": null,
  "providers": ["cloudflare"]
}
```

Cloudflare can [create the `default` gateway on first use](https://developers.cloudflare.com/changelog/post/2026-03-02-default-gateway/). `accountId: null` means the gateway lives in the deployment's own account, which is what makes the binding transport usable.

The binding stays bound whatever you configure here: as well as carrying gateway traffic, it is what the agent's `webFetch` tool runs document-to-Markdown conversion on.

| Configuration | Result |
| --- | --- |
| `enabled: true`, `providers: ["cloudflare"]` | Workers AI models over the binding. No token, no keys of your own. The default. |
| Add `anthropic` or `openai` | Their models appear too. Keys live on the gateway ([Unified Billing or BYOK](https://developers.cloudflare.com/ai-gateway/get-started/#provider-authentication)), not in this repository. Still no token. |
| Add `google` | Needs `CF_AI_GATEWAY_API_TOKEN`. pi's Google adapter refuses a custom fetch, so Google inference cannot ride the binding. |
| `accountId` set to another account | Needs `CF_AI_GATEWAY_API_TOKEN`. The binding only reaches gateways in the Worker's own account, so the generated config sets `CF_AI_GATEWAY_USE_BINDING: "false"` and the HTTPS transport takes over. |
| `enabled: false` | No deployment-managed catalog. Each user supplies their own model API keys — and a Workshop [migrated from the hosted deploy](migrate-from-hosted.md) will show an empty model picker. |

`pnpm check` reports which of the last two applies before it deploys anything.

#### When a token is required

Only the two rows above need one. Create a narrowly scoped [API token](https://dash.cloudflare.com/profile/api-tokens) following the current [AI Gateway authentication guidance](https://developers.cloudflare.com/ai-gateway/configuration/authentication/) — a Run + Read token; current guidance calls for Account permissions `AI Gateway - Read`, `AI Gateway - Edit`, and `Workers AI - Read`. Install it without putting the value on the command line:

```sh
CLOUDFLARE_ACCOUNT_ID=your-account-id pnpm exec wrangler secret put CF_AI_GATEWAY_API_TOKEN --name your-workshop-worker
```

Note: Use the `accountId` from your own `deployment.jsonc`, i.e the account the Workshop deploys to.

In exactly those cases the generated Wrangler config [declares the secret as required](https://developers.cloudflare.com/workers/configuration/secrets/#validate-secrets-before-deploy), so the deploy fails clearly if it is missing. On the default path it does not, so a deployment that needs no token is never blocked waiting for one.

### Observability

The starter enables structured custom logs and a private console-backed Error Reporter, while invocation logs, traces, and browser reporting remain separate controls. See [Observability and error reporting](observability.md) for signal selection, sampling, triage, privacy, source maps, frontend reporting, and external destinations.

## Custom Gatekeepers

Keep deployment-owned Gatekeepers under `packages/`, outside the `cloudflare-os` submodule. `scripts/deploy.ts` binds this repository's example as `GATEKEEPER_CUSTOM` and Context as `GATEKEEPER_CONTEXT`, twice each: on the Workshop with the `GatekeeperVendor` entrypoint for RPC, and on the router with no entrypoint, where the binding name is what routes `/gatekeeper/custom` and `/gatekeeper/context` to it. A Gatekeeper that serves HTTP — an OAuth redirect, for instance — needs both.

The minimal example flow is:

1. `types.d.ts` defines the API visible to TypeScript callers.
2. `CustomSessionImpl.getDeploymentInfo()` authorizes an observation before returning data.
3. `CustomGatekeeper` reads deployment values and creates the session.
4. `CustomAccount` exposes that session as a singleton.
5. `GatekeeperVendor` advertises credential-free auto-provisioning.
6. The Workshop service binding makes the vendor available to Cloudflare OS.

Read the [package guide](../packages/custom-gatekeeper/README.md) and upstream [`write-gatekeeper` skill](https://github.com/cloudflare/cloudflare-os/blob/main/.agents/skills/write-gatekeeper/SKILL.md) before adding OAuth, URL-scoped resources, writes, simulations, hooks, configurator UI, or stricter observer verification.

## Code extensions

Prefer wrapper-owned Workers and [service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/) over patches inside the submodule. Modify upstream only when a Worker boundary cannot express the behavior, and keep the change as a reviewable upstream commit or fork rather than a generated overlay.

## Upgrade

1. Record the current `cloudflare-os` gitlink for rollback.
2. Update the submodule to the intended upstream commit.
3. Review Workshop and Context Wrangler base-config changes and Gatekeeper contracts.
4. Diff `cloudflare-os/pnpm-workspace.yaml`'s `catalog:` against this repository's and re-sync it. Two submodule packages are members of this workspace and resolve `catalog:` here, so a missing entry fails the install and a *stale* one silently gives the tree two copies of `capnweb` — a failure that only appears once the two installs are separate, as they are in CI.
5. Run `pnpm install`, `pnpm --dir cloudflare-os install`, `pnpm lint`, and `pnpm check`.
6. Deploy and verify Access, administrator access, storage, configured AI, Context, custom observations, and the Error Reporter query surface.
7. If needed, restore the previous gitlink and redeploy, or use [Workers rollback](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/) when bindings remain compatible.

Do not update the submodule blindly. The deployment script derives from upstream configs so incompatible base changes remain visible during review and checks.
