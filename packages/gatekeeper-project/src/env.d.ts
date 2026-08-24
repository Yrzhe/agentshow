// Bindings and Durable Object classes Wrangler's generated types cannot infer on their own.
//
// `WIDGET_LOADER` is deliberately absent: Wrangler does infer a `worker_loaders` binding from
// `wrangler.jsonc`, so declaring it here as well would only give the two files a chance to disagree.

declare namespace Cloudflare {
  interface Env {
    /** File bytes. Metadata lives in each project's Durable Object, which is the only index of it. */
    PROJECT_FILES: R2Bucket;
  }

  interface GlobalProps {
    // Populates Cloudflare.Exports, the type of ctx.exports.
    mainModule: typeof import("./index.js");
    // Storage classes exposed as DO namespaces on ctx.exports.
    durableNamespaces:
      | "ProjectDurableObject"
      | "MemberProjectsDurableObject"
      | "WidgetStoreDurableObject"
      | "ProjectGatekeeper";
  }
}
