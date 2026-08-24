// The two shapes `deploy.ts` sits between: `deployment.jsonc` on the way in, and the
// `wrangler.prod.jsonc` files it generates on the way out.
//
// The wrangler side reuses the submodule's own declarations rather than redeclaring them, so a
// base-config change upstream surfaces here as a type error during `pnpm types:scripts` instead of
// as a silently dropped key at deploy time. The imports are type-only, which under
// `verbatimModuleSyntax` erase completely -- `node` never resolves them, so the submodule's
// runtime dependencies are not this script's problem.

import type {
  BindingDecl,
  ObservabilityConfig,
  WranglerConfig,
} from "../cloudflare-os/scripts/release/manifest-lib.ts";

/** A model provider the Workshop can serve through AI Gateway with deployment-managed keys. */
export type AiGatewayProvider = "anthropic" | "openai" | "google" | "cloudflare";

/** Every provider {@link AiGatewayProvider} allows, for validation and for error messages. */
export const AI_GATEWAY_PROVIDERS: readonly AiGatewayProvider[] =
  ["anthropic", "openai", "google", "cloudflare"];

/**
 * The public address of the router Worker. Exactly one field is set; `validateConfig` enforces
 * that, since wrangler would otherwise happily deploy both a custom domain and a workers.dev route.
 */
export interface RouterRoute {
  /** Evaluation route on the account's workers.dev subdomain. */
  workersDev?: boolean;
  /** Production hostname in an active Cloudflare zone. Wrangler creates DNS and TLS for it. */
  customDomain?: string;
}

/** Cloudflare Access trust boundary and the `/admin` allowlist. */
export interface AccessConfig {
  /** Access team origin, HTTPS with no path. */
  issuer: string;
  /** The self-hosted Access application's AUD tag. */
  audience: string;
  /** Access-verified emails allowed into `/admin`. */
  admins: string[];
}

/**
 * Deployment-managed model catalog, served through Cloudflare AI Gateway.
 *
 * Transport is derived rather than configured: the Workshop reaches the gateway over its
 * `WORKERS_AI` binding, which is pre-authenticated inside the Worker's own account. Only a gateway
 * in a *different* account, or the `google` provider, needs `CF_AI_GATEWAY_API_TOKEN` -- see
 * `AiGatewayConfig` in cloudflare-os/packages/workshop-backend/src/ai-gateway.ts, whose constructor
 * throws this script mirrors.
 */
export interface AiGatewayConfigInput {
  /** Whether the Workshop advertises a deployment-managed catalog at all. */
  enabled: boolean;
  /** Gateway name. `"default"` is the one Cloudflare creates for an account on first use. */
  name?: string;
  /** Account owning the gateway. `null` reuses the deployment's own `accountId`. */
  accountId?: string | null;
  /** Providers to advertise. Must be non-empty when enabled. */
  providers?: AiGatewayProvider[];
  /**
   * No longer configurable: Workers AI rides the same gateway route as every other provider.
   * Declared only so `validateConfig` can reject a leftover key loudly -- silently ignoring one
   * produces a deploy that succeeds with an empty model picker.
   */
  workersAi?: never;
}

/** Context Gatekeeper storage and the sharing boundary its data is scoped to. */
export interface ContextConfig {
  /**
   * Stable label isolating Context data belonging to this deployment. `null` scopes it to the
   * deployment's public origin, which is what the hosted deploy does.
   */
  sharingDomain: string | null;
  /** Existing snapshot KV namespace, or `null` for Wrangler automatic provisioning. */
  kvNamespaceId: string | null;
  /** Optional Git-compatible collection storage. Absent or `{}` means disabled. */
  artifacts?: { enabled?: boolean; namespace?: string };
}

/**
 * What one project may hold.
 *
 * A deployment decision rather than a per-project one, and a paid one: file bytes land in the
 * deployment's own R2 bucket. `null` on any field keeps the Worker's own default.
 */
export interface ProjectLimitsConfig {
  /** Largest single file, in bytes. */
  maxFileBytes?: number | null;
  /** Total stored bytes across one project's files. */
  maxTotalBytes?: number | null;
  /** How many files one project may hold. */
  maxFileCount?: number | null;
}

/** Project Gatekeeper storage, the sharing boundary its projects are scoped to, and its quotas. */
export interface ProjectConfig {
  /**
   * Stable label isolating the projects belonging to this deployment. `null` scopes them to the
   * deployment's public origin, matching what `context.sharingDomain` does for Context data.
   *
   * Changing it hides every existing project rather than breaking anything visibly, so it is worth
   * setting explicitly on a deployment whose public origin may move.
   */
  sharingDomain: string | null;
  /** Existing R2 bucket for file bytes, or `null` for Wrangler automatic provisioning. */
  filesBucket: string | null;
  /**
   * Whether widgets may run a `backend.js` of their own, which needs a Worker Loader binding.
   *
   * Off by default, and off is a working deployment rather than a reduced one: widgets serve their
   * files and persist data through their built-in `api/store` either way. What the binding adds is
   * the ability to run a member-written module, and what it costs is
   * [Dynamic Worker Loaders](https://developers.cloudflare.com/workers/runtime-apis/bindings/worker-loader/)
   * on the account -- an account feature, so a deployment that turns this on without it gets a
   * deploy that fails rather than a widget that misbehaves.
   */
  widgetBackends?: boolean;
  /** Per-project quotas. Absent keeps the Worker's own defaults. */
  limits?: ProjectLimitsConfig;
}

/**
 * Limits on the email-code identity provider. Omit a field, or set it to `null`, to keep the
 * Worker's own default.
 *
 * Checked here rather than in the Worker for the same reason the project quotas are: they reach it
 * as `vars`, which are strings, so a typo becomes `NaN` and then a limit that never trips.
 */
export interface EmailCodeIdpLimits {
  /** How long an emailed code stays valid. */
  codeTtlSeconds?: number | null;
  /** Wrong entries before a code is cancelled. */
  maxAttempts?: number | null;
  /** Codes one login attempt may ask for. */
  maxSendsPerSession?: number | null;
  /** Codes one address may be sent per window. */
  maxSendsPerEmail?: number | null;
  /** The window the per-address limit counts over. */
  sendWindowSeconds?: number | null;
}

/**
 * An OIDC provider, owned by this deployment, that signs people in with an emailed code and puts
 * no link in that email.
 *
 * Off by default. A deployment that can allowlist `noreply@notify.cloudflare.com` in its mail
 * security product should do that and keep Cloudflare's own one-time PIN; this exists for the
 * deployments where that allowlist belongs to somebody else.
 *
 * There is no `redirectUri` here. It is derived from `access.issuer`, because the only address this
 * provider may return to is the Access team's own OIDC callback -- and a hand-entered value that
 * disagreed with the Access application would send authorization codes somewhere else.
 */
export interface EmailCodeIdpConfig {
  /** Whether the provider is deployed at all. */
  enabled: boolean;
  /**
   * The provider's own public origin, which becomes its `iss`. `null` derives it from
   * `workers.emailCodeIdp.route.customDomain`, and is invalid on a workers.dev route for the same
   * reason `publicBaseUrl` is.
   */
  issuer?: string | null;
  /** What the sign-in page and the emailed code call this deployment. */
  brand?: string;
  /** The client Access authenticates as. Its secret is a Worker secret, never a config value. */
  clientId?: string;
  /** Who may be sent a code: addresses, `@domain` entries, or the single entry `*`. */
  allowedEmails?: string[];
  /** Envelope sender for the code email, as the delivery provider expects it. */
  mailFrom?: string;
  limits?: EmailCodeIdpLimits;
}

/** Worker telemetry. Maps onto wrangler's `observability` block. */
export interface DeploymentObservabilityConfig {
  enabled: boolean;
  headSamplingRate: number;
  logs: { invocationLogs: boolean };
  traces: { enabled: boolean; headSamplingRate: number };
}

/**
 * `deployment.jsonc`, parsed.
 *
 * This describes the *valid* shape. The file is hand-edited JSONC with no schema behind it, so
 * every field is still checked at runtime by `validateConfig` -- the type is what makes the
 * generation code readable, not a guarantee about what is on disk.
 */
export interface DeploymentConfig {
  /** Cloudflare account owning every Worker and provisioned resource. 32 hex characters. */
  accountId: string;
  /**
   * The deployment's public origin: HTTPS, no path, no trailing slash. `null` derives it from
   * `workers.router.route.customDomain`, and is invalid on a workers.dev route -- the account's
   * workers.dev subdomain is not in this file and wrangler exposes no way to look it up.
   */
  publicBaseUrl: string | null;
  /** Permanent Worker service identities. Each must be unique within the account. */
  workers: {
    /** Owns the public route, serves the frontend, and proxies to every other Worker. */
    router: { name: string; route: RouterRoute };
    workshop: { name: string };
    context: { name: string };
    scheduler: { name: string };
    project: { name: string };
    customGatekeeper: { name: string };
    /** Only required when `errorReporting.enabled`. */
    errorReporter?: { name: string };
    /**
     * Only required when `emailCodeIdp.enabled`.
     *
     * The one Worker besides the router that takes a public route, and it has to: Access sends
     * unauthenticated browsers to it, so it cannot sit behind the Access application it feeds.
     */
    emailCodeIdp?: { name: string; route: RouterRoute };
  };
  access: AccessConfig;
  aiGateway: AiGatewayConfigInput;
  context: ContextConfig;
  project: ProjectConfig;
  /** Display text the example custom Gatekeeper serves to agents. */
  customGatekeeper: { name: string; message: string };
  /** Private explicit-issue destination. */
  errorReporting: { enabled: boolean; environment?: string; release?: string | null };
  /** Optional sign-in provider that emails codes and no links. Absent means disabled. */
  emailCodeIdp?: EmailCodeIdpConfig;
  /** Workshop KV/R2. `null` requests Wrangler automatic provisioning. */
  resources: {
    blueprintsKvNamespaceId: string | null;
    avatarsKvNamespaceId: string | null;
    blueprintContentBucket: string | null;
  };
  observability: DeploymentObservabilityConfig;
}

/**
 * `ObservabilityConfig` plus the traces block. Upstream's type does not declare it, though the
 * backend's own `wrangler.jsonc` sets it and this script writes it for every Worker.
 */
export interface ProdObservabilityConfig extends ObservabilityConfig {
  traces?: { enabled?: boolean; head_sampling_rate?: number };
}

/**
 * A generated `wrangler.prod.jsonc`: the subset of wrangler config upstream's `WranglerConfig`
 * declares, plus the keys this script writes that it does not.
 *
 * Four keys are replaced rather than added to. Upstream's observability type is deliberately closed
 * and has no `traces`; its `artifacts` is a single `BindingDecl`, while wrangler takes an array and
 * the Context Gatekeeper's entry carries a `namespace`; and its KV/R2 bindings are bare
 * `BindingDecl`s, because the release manifest replaces every id with a placeholder while a
 * generated config either names the resource or leaves it for automatic provisioning.
 *
 * `assets` is *not* redeclared -- upstream's is already the shape written here.
 */
export type ProdWranglerConfig =
  Omit<WranglerConfig, "observability" | "artifacts" | "kv_namespaces" | "r2_buckets">
  & {
    /** KV bindings. `id` absent requests Wrangler automatic provisioning. */
    kv_namespaces?: (BindingDecl & { id?: string })[];
    /** R2 bindings. `bucket_name` absent requests Wrangler automatic provisioning. */
    r2_buckets?: (BindingDecl & { bucket_name?: string })[];
    /** The deployment's account, pinned so a stray `CLOUDFLARE_ACCOUNT_ID` cannot redirect it. */
    account_id?: string;
    /** Whether the Worker answers on the account's workers.dev subdomain. */
    workers_dev?: boolean;
    /** Custom-domain routes. Wrangler creates DNS and TLS for each. */
    routes?: { pattern: string; custom_domain: boolean }[];
    /** Turned off on every Worker: a preview URL is an unauthenticated path around Access. */
    preview_urls?: boolean;
    observability?: ProdObservabilityConfig;
    /** Workers AI. Both the AI Gateway transport and what webFetch's `toMarkdown()` runs on. */
    ai?: BindingDecl;
    /** Secrets wrangler refuses to deploy without. Emitted only when one is genuinely needed. */
    secrets?: { required: string[] };
    /** Artifacts namespaces. An array, unlike upstream's single-binding declaration. */
    artifacts?: { binding: string; namespace: string }[];
    /**
     * Worker Loader bindings. Emitted only for a deployment that asked for widget backends, since
     * the binding needs Dynamic Worker Loaders on the account.
     */
    worker_loaders?: BindingDecl[];
  };

/** The generated configs, keyed as `deployment.jsonc` keys them. */
export interface GeneratedConfigs {
  router: ProdWranglerConfig;
  workshop: ProdWranglerConfig;
  context: ProdWranglerConfig;
  scheduler: ProdWranglerConfig;
  project: ProdWranglerConfig;
  customGatekeeper: ProdWranglerConfig;
  /** Absent when `errorReporting.enabled` is false. */
  errorReporter?: ProdWranglerConfig;
  /** Absent when `emailCodeIdp.enabled` is false. */
  emailCodeIdp?: ProdWranglerConfig;
}

/** The upstream base configs the generated ones are derived from. */
export interface BaseConfigs {
  router: ProdWranglerConfig;
  workshop: ProdWranglerConfig;
  context: ProdWranglerConfig;
  scheduler: ProdWranglerConfig;
  project: ProdWranglerConfig;
  customGatekeeper: ProdWranglerConfig;
  errorReporter: ProdWranglerConfig;
  emailCodeIdp: ProdWranglerConfig;
}

/** One build step `deploy.ts` runs before deploying. See `buildCommands`. */
export interface BuildCommand {
  /** Arguments passed to `pnpm`, from the repository root. */
  args: string[];
  /**
   * Variables set on top of the ambient environment for this step alone. Explicit rather than
   * inherited: a build-time flag that arrives by inheritance is one a cached `vp` run would strip.
   */
  env?: Record<string, string>;
}
