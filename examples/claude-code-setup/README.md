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

3. Copy the MCP configuration from `settings.example.json` into `~/.claude/settings.json`:
   ```json
   {
     "mcpServers": {
       "agentshow": {
         "command": "node",
         "args": ["/absolute/path/to/agentshow/packages/mcp/dist/index.js"]
       }
     }
   }
   ```

4. Update the `args` path to your actual local `agentshow` checkout.

5. Optionally copy `CLAUDE.md.example` into your project as `CLAUDE.md` so every session gets the same AgentShow collaboration instructions.

6. Restart Claude Code.

7. Verify in Claude Code:
   - Call `agentshow.register_status` with the current project `cwd`
   - Call `agentshow.get_peers`
   - Open a second Claude Code session on the same project and confirm the two sessions can see each other

## Files

- `settings.example.json`: MCP server config snippet for Claude Code
- `CLAUDE.md.example`: optional project-level collaboration guidance template
