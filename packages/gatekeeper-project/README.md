# Project Gatekeeper

Shared projects for people whose agents are their own.

Adding someone to a gadget upstream means talking to the same agent in the same chat. This Worker is
the other arrangement: everyone keeps their own chats and their own agent, and a **project** is the
only thing they share — its files, the comments on those files, the skills they have agreed on, its
shared configuration, and its **widgets**.

Nothing here is shared between two people's agents. Each member's agent talks to its own gatekeeper
facet holding its own account id; what those facets have in common is the project Durable Objects
they reach, and every one of those answers per member.

[docs/collaboration.md](../../docs/collaboration.md) is the design: why this is a Gatekeeper, what
the visibility rules mean, and what is deliberately left out.

## Widgets

A widget is a small app published into a project: `index.html` plus its assets. Opening its link runs
it. It is not an official Gadget — sharing a gadget shares a chat, which is the arrangement this whole
Worker exists to avoid — and it is not a skill, though it may use the project's skills and shared
configuration.

A widget reuses the file rules rather than bringing its own: the same three visibilities, the same
path-is-intent default under `shared/`, the same owner-only writes, the same approval queue.
`setWidgetVisibility()` is the whole share control.

| | Files | Widgets |
| --- | --- | --- |
| Address | `/f/<projectId>/<fileId>` | `/w/<projectId>/<widgetId>/…` and `…/api/…` |
| Policy | `default-src 'none'; sandbox` | script and its own `api/` allowed; see `widgetContentSecurityPolicy` |
| Capability | signed token in the URL | signed token, then a path-scoped `HttpOnly` cookie |
| Re-checked | at link time | on **every** frontend and `api/` request |

### Persistence without a backend

A widget with nothing in it but an `index.html` can remember things. Its own `api/store` is a small
JSON API this Worker serves over the widget's `WidgetStoreDurableObject`:

```js
await fetch("api/store/draft", { method: "PUT", body: JSON.stringify(draft) });
const { value } = await (await fetch("api/store/draft")).json();
const { entries } = await (await fetch("api/store?prefix=note/")).json();
await fetch("api/store/draft", { method: "DELETE" });
```

`PUT` stores the body verbatim and `GET` returns the same string; keys may contain slashes. Auth, CSP
and cookie renewal are the widget route's own, so a `public` widget's store is reachable by anyone
who can open the widget — the same rule a public backend would have had. It reaches nothing else: not
project files, not another widget's store, and not the project's shared configuration, which is read
only when there is a module to run with it.

### A backend of your own

`setWidgetBackend()` is for a widget that needs logic the browser cannot be trusted with. The module
runs as a real Worker in its own isolate through the `WIDGET_LOADER` Worker Loader binding — nothing
is evaluated in this Worker's scope. Its `env` holds the project's shared configuration values, a
`WIDGET` binding naming the caller's principal, and the same store `api/store` serves. It has no
network: `globalOutbound` is `null`. A widget with a backend owns the whole of its `api/`,
`api/store` included.

`WIDGET_LOADER` is **optional**: Dynamic Worker Loaders is an account feature, so
`project.widgetBackends` in `deployment.jsonc` decides whether the binding is deployed at all
(default: off). Without it, widgets serve their files and their built-in store exactly as they do
with it, and only a widget carrying a `backend.js` gets a 501 naming what is missing.

Writing a widget's assets is auto-approvable. Writing its backend is not, and is the only write here
that never can be: it is code that runs with the project's shared configuration in its environment.
That split is why the built-in store exists — storing a draft should not need a human's attention.

## The agent's view

[`src/types.d.ts`](src/types.d.ts) is the whole API, and the only documentation an agent gets.
`src/types-code.ts` mirrors it as a string because `getTypeScriptTypes()` has to return one at
runtime; it is generated, and `scripts/gatekeeper-types.test.ts` fails when the two drift:

```sh
node scripts/gatekeeper-types.ts --write
```

## Layout

| File | What it holds |
| --- | --- |
| `types.d.ts` | The agent-facing API. Edit this, then regenerate the mirror |
| `model.ts` | Every rule that is a decision rather than a database call, free of DO and RPC types |
| `project-store.ts` | `ProjectDurableObject`: one project's members, files, comments, settings and widgets |
| `member-index.ts` | `MemberProjectsDurableObject`: which projects one account belongs to |
| `widget-store.ts` | `WidgetStoreDurableObject`: the only thing a widget may keep anything in |
| `widget-store-api.ts` | The built-in `api/store` route: that same store as JSON, for a widget with no backend |
| `widget-runtime.ts` | Loading a widget's backend into an isolate, and what its request and `env` hold |
| `sessions.ts` | The RPC sessions an agent calls, and the actions they submit for approval |
| `actions.ts` | Applying, rejecting and reverting an approved action |
| `observers.ts` | Observer verification: whether a collaborator may still see what was read |
| `project-gatekeeper.ts` | Vendor, account, verifier, and the facet the Workshop installs |
| `links.ts` | Project, file and widget addresses, and parsing them back |
| `index.ts` | The Worker entrypoint: `/p/…`, `/f/…` and `/w/…` |

## Storage

File metadata lives in each project's Durable Object; the bytes live in R2 under `PROJECT_FILES`,
because a Durable Object's storage cannot hold a document. The Durable Object holds the only index of
those objects, so an R2 object nobody has a metadata row for is unreachable.

A widget's metadata lives in the same Durable Object, in `widgets` and `widget_files`, and its bytes
in the same bucket under a `widgets/` prefix. They count against the same project quota: one
allowance, not one each. What a widget *stores* is separate, one `WidgetStoreDurableObject` per
widget with limits of its own, because it is reached both by member-written code and by an HTTP route
and should be an object that can hand out nothing else.

The schema is additive — every table is `CREATE TABLE IF NOT EXISTS`, and the widget classes arrive
in a migration tag of their own — so existing projects and files keep working untouched.

## Development

```sh
pnpm exec vp run -F gatekeeper-project build   # tsc
pnpm exec vp run -F gatekeeper-project test    # vitest, under workerd
pnpm exec wrangler deploy --dry-run            # what the deploy will upload
```

`build` and `test` are Vite+ tasks rather than package.json scripts because each reads a path it also
writes; see [`vite.config.ts`](vite.config.ts).

The suites run under `@cloudflare/vitest-pool-workers`, so the Durable Objects are real ones. The
quotas in [`vitest.config.ts`](vitest.config.ts) are deliberately tiny — a few kilobytes — so a
quota test does not have to write megabytes to reach one.
