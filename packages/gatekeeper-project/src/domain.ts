// Namespacing for everything this Worker stores.
//
// One gatekeeper deployment may serve several Workshops, and their projects must not meet. Every
// Durable Object name below is scoped by the sharing domain the Workshop was bound with, so two
// deployments asking for the same project id reach two different objects. Like upstream's Context
// Library, this guards against trusted deployments mixing data, not against a hostile peer config.

/** The domain used when nothing configured one, which is the case in local development. */
export const DEFAULT_SHARING_DOMAIN = "default";

// NUL appears in neither a configured domain, a UUID account id, nor a hex project id.
const SEPARATOR = "\u0000";

/** Durable Object name for a domain-scoped entity. */
export function domainName(sharingDomain: string, id: string): string {
  return `${sharingDomain}${SEPARATOR}${id}`;
}

/** The sharing domain a Worker without vendor props has to fall back on. */
export function configuredDomain(env: { PROJECT_SHARING_DOMAIN?: string }): string {
  return env.PROJECT_SHARING_DOMAIN || DEFAULT_SHARING_DOMAIN;
}
