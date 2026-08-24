// Bindings and Durable Object classes Wrangler's generated types cannot infer on their own.

declare namespace Cloudflare {
  interface Env {
    /** File bytes. Metadata lives in each project's Durable Object, which is the only index of it. */
    PROJECT_FILES: R2Bucket;

    /**
     * How a widget's backend is run: as a real Worker in an isolate of its own.
     *
     * Optional because a deployment can be perfectly useful without it -- everything except widget
     * backends works the same -- and the route says so rather than failing obscurely.
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
