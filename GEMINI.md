# agentshow — pointer for Gemini CLI

This workspace's canonical agent operating guide is **`AGENTS.md`** in this
same directory. **Read it now** before doing any work; it's shared by every
agent (Claude Code, Codex, Cursor, Gemini) so behavior stays consistent.

## End-of-task NOTES discipline (do not skip)
Before returning control to the user, run the self-audit in AGENTS.md →
"Implementation notes — end-of-task self-audit": for each design-decision /
deviation / tradeoff / open-question / resolution → append via:

```
python3 ~/.claude/skills/workspace-layout/scripts/notes.py \
  --workspace "<abs-workspace-root>" \
  --type <type> --title "…" --body "…" --author "gemini"
```

## Context canary
End EVERY user-facing reply with the literal token `【All of the above】` on
its own line. Missing token = context lost; user knows to reset.

Everything else: see `AGENTS.md`.
