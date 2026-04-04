# VPS Deployment Guide

## System Requirements

- Linux VPS with `x86_64` or `arm64`
- Node.js `20+` if running without Docker
- Docker Engine + Docker Compose plugin if running with containers
- 1 GB RAM minimum, 2 GB recommended
- Persistent disk space for the SQLite database and backups

## Environment Variables

- `JWT_SECRET`: required. Long random string used to sign session cookies and API tokens.
- `DATABASE_PATH`: required for Node deployment. SQLite file path, for example `/data/agentshow.db`.
- `PORT`: optional. HTTP port for the Node server. Default is `3000`.
- `ANTHROPIC_API_KEY`: optional. Needed only if your local workflow or companion daemon talks to Anthropic directly.

Current server builds also support the newer generic AI envs from `.env.example`:

- `AI_PROVIDER`
- `AI_API_KEY`
- `AI_MODEL`

## Docker Deployment

1. Clone the repo on the VPS.
2. Copy `.env.example` to `.env`.
3. Set at least `JWT_SECRET`.
4. Start the service:

```bash
docker compose up -d
```

5. Check health:

```bash
docker compose ps
curl http://127.0.0.1:3000/api/health
```

6. View logs if needed:

```bash
docker compose logs -f agentshow
```

The provided `docker-compose.yml` mounts `/data` as a persistent volume, so the SQLite database survives container restarts.

## Non-Docker Deployment

1. Install Node.js 20+ and `pnpm`.
2. Install dependencies:

```bash
pnpm install --frozen-lockfile
```

3. Create a `.env` file and set:

```bash
JWT_SECRET=change-me
DATABASE_PATH=/var/lib/agentshow/agentshow.db
PORT=3000
```

4. Build the server:

```bash
pnpm --filter @agentshow/server build
```

5. Start it:

```bash
cd packages/server
node dist/main.js
```

## Nginx Reverse Proxy Example

```nginx
server {
  listen 80;
  server_name agentshow.example.com;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

After DNS is live, add HTTPS with Certbot or your preferred ACME client.

## systemd Service Example

```ini
[Unit]
Description=AgentShow Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/agentshow/packages/server
Environment=JWT_SECRET=change-me
Environment=DATABASE_PATH=/var/lib/agentshow/agentshow.db
Environment=PORT=3000
ExecStart=/usr/bin/node dist/main.js
Restart=always
RestartSec=5
User=agentshow
Group=agentshow

[Install]
WantedBy=multi-user.target
```

Reload and enable:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now agentshow
sudo systemctl status agentshow
```

## Backup Recommendations

If SQLite is running in WAL mode, back up all three files together when present:

- `agentshow.db`
- `agentshow.db-wal`
- `agentshow.db-shm`

Recommended approaches:

1. Stop the app briefly, then copy the database files.
2. Or use SQLite's online backup command:

```bash
sqlite3 /var/lib/agentshow/agentshow.db ".backup '/var/backups/agentshow-$(date +%F).db'"
```

3. Compress and ship backups off-host on a schedule.

Test restore regularly on a separate machine.

## Security Recommendations

- Put the service behind HTTPS only.
- Restrict inbound traffic with a firewall. Usually only `22`, `80`, and `443` should be open.
- Keep `JWT_SECRET` long and random.
- Treat API tokens like passwords and rotate them if leaked.
- Store `.env` with file permissions such as `chmod 600`.
- Do not expose SQLite files over a shared or public directory.
- Review webhook URLs carefully because outgoing notifications may contain session metadata.
