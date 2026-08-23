# Project Gatekeeper

Shared projects for people whose agents are their own.

Adding someone to a gadget upstream means talking to the same agent in the same chat. This Worker is
the other arrangement: everyone keeps their own chats and their own agent, and a **project** is the
only thing they share — its files, the comments on those files, the skills they have agreed on, and
its shared configuration.

Nothing here is shared between two people's agents. Each member's agent talks to its own gatekeeper
facet holding its own account id; what those facets have in common is the project Durable Objects
they reach, and every one of those answers per member.

[docs/collaboration.md](../../docs/collaboration.md) is the design: why this is a Gatekeeper, what
the visibility rules mean, and what is deliberately left out.

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
| `project-store.ts` | `ProjectDurableObject`: one project's members, files, comments and settings |
| `member-index.ts` | `MemberProjectsDurableObject`: which projects one account belongs to |
| `sessions.ts` | The RPC sessions an agent calls, and the actions they submit for approval |
| `actions.ts` | Applying, rejecting and reverting an approved action |
| `observers.ts` | Observer verification: whether a collaborator may still see what was read |
| `project-gatekeeper.ts` | Vendor, account, verifier, and the facet the Workshop installs |
| `links.ts` | Project and file addresses, and parsing them back |
| `index.ts` | The Worker entrypoint: `/p/<projectId>` and `/f/<projectId>/<fileId>` |

## Storage

File metadata lives in each project's Durable Object; the bytes live in R2 under `PROJECT_FILES`,
because a Durable Object's storage cannot hold a document. The Durable Object holds the only index of
those objects, so an R2 object nobody has a metadata row for is unreachable.

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
