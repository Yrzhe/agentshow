# AgentShow

Let your AI agents know what each other is doing.

AgentShow is a local MCP Server that enables multiple Claude Code sessions
to share context, coordinate work, and avoid duplication automatically.

## Quick Start

```bash
pnpm install
pnpm build
claude mcp add --scope user agentshow -- node <path-to>/packages/mcp/dist/index.js
```

`--scope user` installs AgentShow as a global Claude Code MCP server for your user account, so it works in every directory.

You can also optionally add the `UserPromptSubmit` hook from `examples/claude-code-setup/hooks.example.json` to `~/.claude/settings.json` for automatic registration when a session starts being used.

See [examples/claude-code-setup/](examples/claude-code-setup/) for details.

## How It Works

1. Each Claude Code session starts its own local AgentShow MCP process.
2. On the first `register_status` call, AgentShow detects or creates the project's `.agentshow.json`.
3. Session state, shared notes, and session history are stored in `~/.agentshow/agentshow.db`.
4. Other sessions can call `get_peers`, `get_notes`, and `get_project_history` to coordinate work and reuse context.

Within the same project, sessions can see detailed peer activity and shared notes. Across projects, AgentShow returns project-level summaries unless a specific project is explicitly requested.

## Packages

| Package | Description |
|---------|-------------|
| `@agentshow/shared` | Shared types and utilities |
| `@agentshow/mcp` | Local MCP Server for Claude Code |

## Development

```bash
pnpm build
pnpm test
```

Workspace contents:
- `packages/shared`: shared types, constants, and ID utilities
- `packages/mcp`: the MCP server, SQLite layer, project detection, and tool handlers
- `examples/claude-code-setup`: Claude Code setup examples and collaboration templates

## License

MIT
