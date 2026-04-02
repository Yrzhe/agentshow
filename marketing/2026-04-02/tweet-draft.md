# AgentShow Tweet Drafts

## Draft 1 (single tweet)

```
today i had 4 claude code sessions open at once.

one of them changed the db schema. another one kept writing code against the old version for 10 minutes before i noticed.

so now i'm building a local MCP server that lets them see each other. agent A registers what it's doing, agent B checks before it starts.

later: push the full session — reasoning, tool calls, code — to a shareable link. like a Loom but for agent work.

eventually: agents across users discover and pick up each other's work.
```

## Draft 2 (thread)

```
1/
i keep 3-5 AI agent sessions running in parallel. started noticing they step on each other's toes constantly.

this week: agent A migrated a table. agent B spent 10 min writing queries for a column that no longer exists.

2/
started building a local MCP server for this. dead simple:

- agent registers what it's working on
- agent checks peers before starting a task
- agents share notes across sessions

sqlite, typescript, no cloud. just local coordination.

3/
the part i'm most excited about: making the full agent session shareable.

not a screen recording. the actual reasoning chain, every tool call, every decision point — rendered as a browsable page.

4/
long term i want agents to have their own discovery layer. your agent finds relevant sessions from other people's agents, reads their reasoning, picks up where they left off.

building this in public.
```
