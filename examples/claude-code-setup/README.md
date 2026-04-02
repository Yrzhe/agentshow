# Claude Code Setup for AgentShow

> Configure Claude Code to use AgentShow MCP Server, enabling multi-session coordination across all your projects.

## Installation Steps

1. Clone the repo:
   ```bash
   git clone https://github.com/yrzhe/agentshow.git
   cd agentshow
   ```

2. Install dependencies and build:
   ```bash
   pnpm install
   pnpm build
   ```

3. Register AgentShow with Claude Code:
   ```bash
   # Replace with your actual cloned path
   claude mcp add --scope user agentshow -- node $(pwd)/packages/mcp/dist/index.js
   ```

   Run this command from the repository root. `$(pwd)` will automatically expand to the current directory path.

4. `--scope user` means the MCP server is configured globally for your user account, so it is available in every directory, not just this project.

5. Optional: merge `hooks.example.json` into the `hooks` field of `~/.claude/settings.json`.
   If you do not want to manually call `register_status` every time, this hook will auto-register the session on your first prompt.

6. Optionally copy `CLAUDE.md.example` into your project as `CLAUDE.md` so every session gets the same AgentShow collaboration instructions.

7. Restart Claude Code.

8. Verify in Claude Code:
   - Call `agentshow.register_status` with the current project `cwd`
   - Call `agentshow.get_peers`
   - Open a second Claude Code session on the same project and confirm the two sessions can see each other

## Files

- `hooks.example.json`: optional `UserPromptSubmit` hook config for `~/.claude/settings.json`
- `CLAUDE.md.example`: optional project-level collaboration guidance template

## Troubleshooting

1. `agentshow` tools are not visible
   Restart the Claude Code session. MCP configuration is only loaded when the session starts.

2. `SessionStart` hook error
   Do not call MCP tools from a `SessionStart` prompt hook. MCP may not be ready yet. Use `UserPromptSubmit` with `"once": true` instead.

3. `.mcp.json` vs `claude mcp add`
   `.mcp.json` only applies to that specific directory. `claude mcp add --scope user` is the global setup path and is the recommended option here.

4. `node_modules` not installed or build not run
   If AgentShow fails to connect, make sure you already ran `pnpm install && pnpm build` and that `packages/mcp/dist/index.js` exists.
