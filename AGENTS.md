# agentshow — Agent Operating Guide

> Canonical instructions for ANY AI agent (Claude Code, Codex, Cursor, …)
> working in this workspace. `CLAUDE.md` imports this file via `@AGENTS.md`.
> **Edit THIS file, never CLAUDE.md.**

## Project
- **Name:** agentshow
- **Description:** 单人多 agent 的协作工作台：agent 有身份、project 有公共 workspace，agent 之间通过文件和 @提及协作。建在 Cloudflare Agents SDK 上。
- Identity / GitHub / Notion of record: `metadata.json`

## Workspace rules
This workspace follows the `workspace-layout` skill. Before writing any file,
classify the artifact and place it per that skill's path map — do NOT invent
structure. Do NOT add `CLAUDE.md`/`AGENTS.md` into a subfolder that is its own
git repo or already has one.

<!-- AGENT-CONDUCT:BEGIN — generated from workspace-layout/references/agent-conduct.md; edit there, then re-run sync_agent_conduct.py -->

## Evolving the system

- **Delete obsolete paths, don't wrap them.** Remove dead code instead of adding
  compatibility layers, fallbacks, or migrations. Exception: an API, file format, or
  schema with consumers you do not control — migrate deliberately there, and say so.
- **Never trade a working product for unfinished complexity.** Grow in layers: the
  smallest version that works end to end, then each capability on top of something that
  already works. Runnable at every commit, not only at the end.
- **Simple ≠ temporary.** Choose the simplest implementation that fully meets current
  requirements; do not accept a stopgap you already intend to replace. Simplicity means
  removing speculation, not deferring the real decision.
- **Check before you reimplement.** Prefer what the project already depends on, then an
  established well-maintained library, then your own code. Do not assume a library lacks
  a capability without reading its docs and types.

## Deliverables — ship the final state, not the process

Write deliverables as self-contained final-state artifacts. Incorporate feedback directly
without mentioning drafts, versions, review rounds, prior wording, superseded decisions, or
the editing process unless the user explicitly requests a changelog, history, or decision
record. An edited document must read as if it were written that way the first time.

Three leaks, all banned:

- **Version narration** — "V1's conclusion was overturned", "originally A, now B",
  "revised after the second review". Write the current conclusion; the path there stays out.
- **Self-correction narration** — "earlier I said X, but actually Y", "correction:",
  "note: the section above is inaccurate". No version numbers, same noise. State the
  correct thing; leave no scar.
- **Describing the change instead of making it** — "changed A to B", "added XX here".
  Present B itself; do not narrate the act of changing.

Applies to docs, code comments, READMEs, plans, reports, PR bodies.

**Exceptions (history IS the content):** changelogs, ADRs / decision records, migration
notes, post-mortems, and `docs/implementation/NOTES.md` — that file is append-only by
design and records supersessions on purpose. Saying "here's what I changed" in chat is
normal communication; this rule governs what lands **in files**.

## Ground every claim in something you actually read

State facts about the system only after reading the thing you are describing.
"What the code does", "which checks exist", "what this config sets", "what
happened in that run" — each is a claim about a file that can be opened, and
opening it costs seconds. Writing it from memory costs the reader their trust in
everything else you wrote.

- **Read first, then write.** Not write-then-verify: once a plausible paragraph
  exists it reads like fact to you too. If describing something requires you to
  remember it, open it instead.
- **Carry the locator** — `file:line`, the command you ran, the output you saw.
  A claim with one can be checked in a click; the same claim without one has to
  be taken on faith or re-derived from scratch.
- **Context is not a read.** Something seen many turns ago, or arriving via a
  summary, is a snapshot that may already be stale — and may be from a different
  project. Re-open it.
- **Lists are the high-risk shape.** A bullet list of "the checks that exist" or
  "the fields it supports" signals *I enumerated this*, so readers stop
  verifying. A list built from memory fails in both directions at once: it
  invents entries that were never there and silently drops ones that were.
  Enumerate from the file, or say you are naming examples rather than the set.

**Judgment is welcome; disguised judgment is not.** Recommendations, hypotheses
and estimates are the useful part of the work — but the facts they rest on must
themselves be ones you checked, and the judgment must be phrased as judgment.
"This probably fails on empty input" and "This fails on empty input" are
different claims; only the second requires you to have run it. When something
cannot be checked, say so in a clause and move on — an explicit "not verified"
keeps the rest of the document trustworthy.

The asymmetry is why this needs to be a rule rather than a habit: an unverified
claim reads exactly like a verified one, so nothing downstream catches it. The
reader acts on it, and the correction arrives after the decision was made.

## Say who you are when writing to another agent

A message that does not name its sender is read as a message from the human.
That is not a small misattribution: a user's instruction outranks skills and
defaults, so an unsigned agent request inherits an authority it was never
granted — and the recipient cannot route a reply, or tell anyone later who asked
for the work.

Open with your identity whenever you address another agent:

- **Who** — the name you are addressable by, plus the role you are acting in.
- **What you are** — an agent, not the human. State it; do not leave it inferable.
- **How a reply gets back** — the channel and handle that reach you. If you
  cannot receive one, say so, so nobody waits for an exchange that cannot happen.

**Only where the transport drops it.** Some channels carry the sender in the
protocol — `agent-bus` requires `--from`, so repeating it in the body is noise.
Others carry nothing: a prompt sent to a named agent, a note written on a shared
canvas, a task handed to a subagent — all arrive as bare text. There, the first
line of the body is the only place identity can live.

The same applies to anything you leave for an agent to find later — shared notes,
handoff files, an append-only log. A reader arriving hours later has even less
context than the recipient of a live message.

Passing work along does not transfer authorship: when you relay a human's
request, say both that you are relaying and who asked. "yrzhe wants X" and
"I want X" are different claims, and the recipient will treat them differently.

## Watch anything you start

Starting a long-running command is only half the action. Decide **how you will
learn that it finished** before you start it, and keep that channel open until
you have the result. An agent that launches work and moves on has not delegated
it — it has lost it.

- **Launching is not finishing.** A backgrounded command returns as soon as the
  shell hands it off. That return says the process started, nothing more. Treat
  "the command came back" and "the work is done" as unrelated facts.
- **Arrange the signal up front** — the runtime's completion notification, a
  persistent monitor on the output, or a polling loop you own. Pick one when you
  launch, not after you notice you are in the dark.
- **Poll real state, not elapsed feeling.** Is the process still alive? Has the
  output file grown? Has the count at the far end moved? Time-since-launch is not
  progress, and an estimate made while waiting is a guess wearing a number.
- **Assume silent failure is possible.** A command can be missing from this
  shell, blocked by permissions, or killed by a timeout, and still leave an exit
  path that looks ordinary. Read the output before believing the outcome — for a
  long job, read it again at the end, because a failure at minute nine looks
  exactly like success at minute one if you only checked early.
- **Report what you observed, not what you launched.** "Started the sync" and
  "the sync completed, N items, 0 failures" are different sentences. Only the
  second one has been verified, and only it should be written as a result.

## Go deep, not surface-level — on any "learn from / follow X" task

When a task sends you to LEARN from something (study a reference, follow an SOP,
copy how others do it, find examples to imitate), the default failure is staying
on the surface: reading what someone *said* they do, not how they actually did
it. That is skimming, not research, and it ships shallow work.

- **Read the source, not a summary of it.** A tweet about an article, a README
  about a repo, a title about a technique — these are pointers. Open the actual
  article / repo / skill file and read the mechanism inside.
- **Go one level below the claim.** "They use a two-layer grid" is the surface.
  Why that grid, what spacing, what they do that you can't see at a glance — that
  is the part worth copying.
- **When imitating, gather real references first.** Building a cover? Search how
  people actually make covers (X, the skills they share), open the techniques
  they bury *inside* those skills, and extract the specifics — don't add one
  visible flourish (a two-layer grid) and call it done.
- **Signs you went shallow:** a cosmetic tweak presented as the work; "I looked,
  it's basically X" with no specifics; citing a source whose title/abstract is
  all you read. If that's all you have, you're not finished.

Cost asymmetry: skimming feels done and isn't; going deep costs one more pass and
is the difference between imitating the look and imitating the craft.

<!-- AGENT-CONDUCT:END -->

## Scratch space — you own what you create

`/tmp` (and `/private/tmp`) is for bytes that die with your run. Everything else belongs in
this workspace. Apply one test:

> **Does anything need to read this after my run ends?**
> Yes → workspace, under the path the layout skill assigns.
> No → scratch, and you delete it before you exit.

Reports, verification receipts, SHA sidecars, artifacts, evidence, and anything another
agent or a later session may cite are all "yes" — they do not live in scratch, no matter how
disposable they felt while producing them.

**Clean up on every exit path.** Record your scratch root when you start; remove it when you
finish — on success, on failure, and when your task is cancelled or you are dismissed
mid-run. A dismissed reviewer still owns its build cache. Leaving it behind pushes the cost
onto the host and onto whoever runs next.

**Do not duplicate bulk.** Before copying a build tree, a checkout, or a model directory,
ask whether the copies could share instead:

- Same volume on macOS → `cp -c` (APFS copy-on-write clone: near-zero time and space)
- Many variants of one build → share one build directory, rebuild only what differs
- Need only the delta → keep the diff and the result, not a full copy of the inputs

N variants must not produce N full copies. This is the difference between a run costing
hundreds of megabytes and costing tens of gigabytes.

**Sanity check before you exit:** `du -sh` your scratch root. If it is measured in gigabytes
and you are done, it should no longer exist.

## Implementation notes — end-of-task self-audit (MANDATORY)

`docs/implementation/NOTES.md` is the **append-only** record of every non-
obvious thing that happens here. Never edit or delete prior entries.

**Before you return control to the user / end your turn, run this audit:**

1. Did I make any **design-decision** (ambiguous spec, picked an interpretation)?
2. Did I **deviate** from the spec/request (and why)?
3. Did I weigh a **tradeoff** (what alternatives, why this one)?
4. Did I defer an **open-question** for the user to confirm/revise?
5. Am I **resolving** a prior open-question?

For EACH "yes" → append an entry via the helper below. Saying "nothing to log"
is only acceptable after you explicitly performed the audit — not by default.
This is non-negotiable; it survives across agents and devices, so it must not
depend on memory.

```
python3 ~/.claude/skills/workspace-layout/scripts/notes.py \
  --workspace "<abs-workspace-root>" \
  --type design-decision|deviation|tradeoff|open-question|resolution \
  --title "short title" --body "full markdown body" \
  --author "<your agent id, e.g. claude-code|codex-<name>|cursor|gemini>"
```

Human viewer: open `docs/implementation/notes.html` (data is embedded — just
double-click, no server needed).

## Issue tracker (JSON + CLI — status board, MANDATORY)

Bugs/features live in **`docs/implementation/issues_<project>.json`** (one file
per project). NEVER hand-edit — drive with `issues.py`, which auto-increments
IDs (`<PREFIX>-<num>`), records change history, and regenerates the combined
`docs/implementation/notes.html` dashboard — one page whose left sidebar jumps
between the NOTES log and each project's issue **kanban** (double-click; embeds
NOTES + every `issues_*.json`).

```
ISS=~/.claude/skills/workspace-layout/scripts/issues.py
python3 $ISS --workspace <abs-root> --project <name> --author <agent> create \
  --title "…" --severity P0|P1|P2|P3 [--status open] [--owner …] [--evidence "…"]
python3 $ISS --workspace <abs-root> --project <name> --author <agent> set <ID> --status fixed [--note "why"]
python3 $ISS --workspace <abs-root> [--project <name>] list [--status open]
```

Status: 🔴 open · 🟡 in-progress · 🔵 shipped (awaiting verify) · 🟢 fixed
(reviewer-verified) · ⚪️ backlog · ⚫️ wontfix. Discipline: new problem →
`create` immediately; move status as you work; `fixed` needs independent
verification (not self-report); each fix round includes an infra audit (did the
bytes/cost/DB row actually land?), not just a UI walkthrough.

## Context canary — every reply ends with 【All of the above】

At the **very end** of every user-facing reply, append the literal token
`【All of the above】` on its own line. This is a heartbeat: if AGENTS.md is
loaded, the token appears; if a session's context got reset / compacted past
the AGENTS.md boundary, the token vanishes and the user knows to re-prime.

- Applies to every turn including 1-line acknowledgements, errors, refusals
- Place after the final substantive content — do not nest inside code fences
- Do not embellish ("【All of the above】 ✓" etc.) — the exact token only
- Persist this rule across topic shifts within the session

## Capability skills — load the right playbook BEFORE you start

Do not reason from memory on work that has a dedicated playbook. Before you
begin, check whether one of these matches the task, and if so **load it first**
(Claude Code: invoke the Skill; Codex/Cursor/Gemini/others: read
`~/.claude/skills/<name>/SKILL.md`). The skill's steps override your defaults.

| If the task is… | Load this skill first |
|---|---|
| Shipping a **full-stack feature end-to-end** (research code → slice → design UI/architecture → implement → review loop → test → push/CI) | **`fullstack-shipping`** |
| Running a **fleet of agents** — recruiting Codex/opencode/Claude Code via Maestri for parallel work, or spawning review subagents; anytime a finished sub-agent could stall you, or a review needs multiple attacking perspectives | **`multi-agent-orchestration`** |

Rule of thumb: a single-file edit goes straight to the product's implement/bug-fix
skill; anything bigger (a feature, a parallel build, an adversarial review) starts
by loading the playbook above. If unsure whether a skill applies, load it — a
wrong load is cheap, skipping the right one is not.

## Project-specific guidance
<!-- The ONLY hand-edited section. Add project rules / constraints below. -->

<!-- moi-board:start -->
## Implementation board (moi)

`docs/implementation` has a live board in this workspace's moi UI: the decision
log on the left, one kanban per project on the right, at tab `view:board`, with a
summary card on the widgets dashboard.

- **It is a viewer, not a store.** NOTES.md and `issues_*.json` remain the source
  of truth and keep their formats. The board reads them on every load.
- **Writes still go through the scripts.** Dragging a card runs
  `issues.py set`; the board never edits a file itself. Do not hand-edit either
  file, and do not add a second write path.
- **First run in a fresh checkout:** `moi bundle` (moi installs the applet
  dependencies itself on first start).
- After changing the underlying files, `moi refresh` re-pulls the data without a
  rebuild.

Source lives in `.moi/` (`views/board.tsx`, `widgets/board-summary.tsx`,
`lib/board-data.ts`); the template is
`~/.claude/skills/workspace-layout/assets/moi-board/`.
<!-- moi-board:end -->
