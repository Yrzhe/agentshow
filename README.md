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

## Product Direction

AgentShow is moving toward a new architecture:

1. A local daemon monitors Claude Code session files passively.
2. A Claude Code skill provides user-facing controls and workflow entry points.
3. A cloud backend ingests session events for observability, history, and UI.

The original MCP server remains in this repository and continues to work as a
standalone coordination tool.

## Packages

| Package | Description |
|---------|-------------|
| `@agentshow/shared` | Shared types and utilities |
| `@agentshow/mcp` | Local MCP Server for Claude Code |
| `@agentshow/daemon` | Local daemon for automatic Claude Code session monitoring. Coming Soon |
| `@agentshow/skill` | Claude Code skill for controlling AgentShow workflows. Coming Soon |

## Development

```bash
pnpm build
pnpm test
```

Workspace contents:
- `packages/shared`: shared types, constants, and ID utilities
- `packages/mcp`: the MCP server, SQLite layer, project detection, and tool handlers
- `packages/daemon`: placeholder for the local monitoring daemon
- `packages/skill`: placeholder for the Claude Code skill package
- `examples/claude-code-setup`: Claude Code setup examples and collaboration templates

## License

MIT
