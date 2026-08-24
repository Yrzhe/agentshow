// Bindings and Durable Object classes Wrangler's generated types cannot infer on their own.

declare namespace Cloudflare {
  interface Env {
    /** File bytes. Metadata lives in each project's Durable Object, which is the only index of it. */
    PROJECT_FILES: R2Bucket;

    /**
     * How a widget's own `backend.js` runs, when a deployment has one.
     *
     * Declared here rather than inferred from `wrangler.jsonc`, and optional, because that is what
     * it is: Dynamic Worker Loaders is an account feature, so a deployment that does not have it
     * binds no loader and this Worker still serves widget frontends and their built-in stores.
     * Wrangler would infer a required binding from a `worker_loaders` entry, which would be a
     * promise the deployment cannot keep.
     */
    WIDGET_LOADER?: WorkerLoader;
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
