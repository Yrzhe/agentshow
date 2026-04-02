# Claude Code Setup for AgentShow

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

3. Copy the MCP configuration from `mcp_servers.example.json` into `~/.claude/mcp_servers.json`:
   ```json
   {
     "agentshow": {
       "command": "node",
       "args": ["/absolute/path/to/agentshow/packages/mcp/dist/index.js"]
     }
   }
   ```

4. Update the `args` path to your actual local `agentshow` checkout.

5. Optional but recommended: merge `hooks.example.json` into the `hooks` field of `~/.claude/settings.json`.
   This adds a `SessionStart` hook that tells Claude Code to silently call `agentshow.register_status` as soon as a new session starts.

6. Optionally copy `CLAUDE.md.example` into your project as `CLAUDE.md` so every session gets the same AgentShow collaboration instructions.

7. Restart Claude Code.

8. Verify in Claude Code:
   - Call `agentshow.register_status` with the current project `cwd`
   - Call `agentshow.get_peers`
   - Open a second Claude Code session on the same project and confirm the two sessions can see each other

## Files

- `mcp_servers.example.json`: MCP server config snippet for `~/.claude/mcp_servers.json`
- `hooks.example.json`: optional `SessionStart` hook config for `~/.claude/settings.json`
- `CLAUDE.md.example`: optional project-level collaboration guidance template
