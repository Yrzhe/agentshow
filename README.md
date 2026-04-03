# AgentShow — See what your AI agents are doing

AgentShow is an agent observability platform for Claude Code and similar agent
workflows. It is evolving from a multi-session coordination tool into a
Daemon + Skill + Cloud architecture for monitoring, syncing, and understanding
what your AI agents are doing.

## Quick Start

The v1 local MCP Server is still available and supported as a standalone
open-source tool:

```bash
pnpm install
pnpm build
claude mcp add --scope user agentshow -- node <path-to>/packages/mcp/dist/index.js
```

`--scope user` installs AgentShow as a global Claude Code MCP server for your
user account, so it works in every directory.

You can also optionally add the `UserPromptSubmit` hook from
`examples/claude-code-setup/hooks.example.json` to `~/.claude/settings.json`
for automatic registration when a session starts being used.

See [examples/claude-code-setup/](examples/claude-code-setup/) for details.

## Architecture

AgentShow uses a Daemon + Skill + Cloud architecture:

1. **Daemon** — A local background process monitors all Claude Code sessions
   automatically. Zero configuration, zero agent involvement.
2. **Skill** — A Claude Code skill provides in-session commands (`/peers`,
   `/stats`, `/projects`, `/history`).
3. **Cloud** — A cloud backend for observability dashboard and team features.
   (Coming soon)

The original MCP server remains in this repository and continues to work as a
standalone coordination tool.

## Packages

| Package | Description | Status |
|---------|-------------|--------|
| `@agentshow/shared` | Shared types and utilities | Ready |
| `@agentshow/mcp` | Local MCP Server for Claude Code | Ready |
| `@agentshow/daemon` | Local daemon for automatic session monitoring | Ready |
| `@agentshow/skill` | Claude Code skill for AgentShow commands | Ready |

## Install Daemon

```bash
pnpm install && pnpm build
./packages/daemon/scripts/install.sh    # starts as macOS LaunchAgent
./packages/skill/scripts/install.sh     # installs skill to ~/.claude/skills/
```

Verify: `curl http://127.0.0.1:45677/health`

Uninstall: `./packages/daemon/scripts/uninstall.sh`

## Development

```bash
pnpm build
pnpm test    # 69 tests (daemon 43 + mcp 26)
```

Workspace contents:
- `packages/shared`: shared types, constants, and ID utilities
- `packages/mcp`: the MCP server, SQLite layer, project detection, and tool handlers
- `packages/daemon`: local daemon — session discovery, JSONL parsing, HTTP API
- `packages/skill`: Claude Code skill for /peers, /stats, /projects, /history
- `examples/claude-code-setup`: Claude Code setup examples and collaboration templates

## License

MIT
