# @agentshow/worker — Cloud Dashboard

## Prerequisites
- Cloudflare account
- GitHub OAuth App

## Deploy

1. Clone and build:
   `git clone https://github.com/yrzhe/agentshow && cd agentshow`
   `pnpm install && pnpm build`

2. Create D1 database:
   `cd packages/worker`
   `npx wrangler d1 create agentshow`
   Copy the `database_id` from output and update `wrangler.toml`.

3. Run migrations:
   `npx wrangler d1 migrations apply agentshow`

4. Set secrets:
   `npx wrangler secret put GITHUB_CLIENT_ID`
   `npx wrangler secret put GITHUB_CLIENT_SECRET`
   `npx wrangler secret put JWT_SECRET`

5. Deploy:
   `npx wrangler deploy`

6. Create GitHub OAuth App:
   - Go to `https://github.com/settings/applications/new`
   - Application name: `AgentShow`
   - Homepage URL: `https://agentshow.<your-subdomain>.workers.dev`
   - Callback URL: `https://agentshow.<your-subdomain>.workers.dev/api/auth/github/callback`

## Connect Daemon

After deploying, generate an API token from the Settings page, then configure your local daemon:

```sh
echo '{
  "cloud": {
    "url": "https://agentshow.<your-subdomain>.workers.dev",
    "token": "as_your_token_here"
  },
  "privacy": { "level": 1 }
}' > ~/.agentshow/config.json
```

Restart the daemon:

```sh
launchctl unload ~/Library/LaunchAgents/com.agentshow.daemon.plist && launchctl load ~/Library/LaunchAgents/com.agentshow.daemon.plist
```

## Privacy Levels
- `0`: Local only (default, nothing uploaded)
- `1`: Metadata (session times, token counts, no content)
- `2`: Summary (+ event summaries, tool names, 200-char previews)
- `3`: Full (+ complete content)
