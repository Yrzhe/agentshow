# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- Self-hosted Node.js server (`@agentshow/server`) as primary deployment target
  - Hono + @hono/node-server, better-sqlite3 with WAL mode
  - Auto-migration runner from SQL files
  - All API routes ported: sync, sessions, projects, search, notes, usage, tokens, auth, summary
  - Configurable AI summary (Anthropic API / disabled)
  - `docker compose up` for one-click local development
- Docker deployment: multi-stage Dockerfile (Node 20 alpine) + docker-compose.yml
- `.env.example` for environment configuration
- Bridge Phase 4: Daemon API exposes MCP data (GET /notes, sessions include task/files)
- Skill commands: `/notes` and `/session-detail` for unified MCP+Daemon data
- Daily work summary: `GET /api/daily-summary?date=YYYY-MM-DD` with dashboard page
- Token cost estimation: `GET /api/usage/cost?days=N` with model pricing (Opus/Sonnet/Haiku)
- Dashboard usage page shows estimated dollar cost alongside token counts
- Budget alerts: daily/monthly budget caps with progress tracking
  - `GET /api/budget` returns budget settings with current usage, threshold, and limit status
  - `PUT /api/budget` to create/update budget settings
  - `DELETE /api/budget/:type` to remove budget settings
  - Dashboard Budget page with progress bars (green/yellow/red) and budget management form
  - Migration `0005_budgets.sql` with `budget_settings` table
- Cost attribution: breakdown costs by project, session, and tool type
  - `GET /api/cost/by-project?days=N` — project-level cost ranking
  - `GET /api/cost/by-session?days=N&project=slug` — session-level cost breakdown
  - `GET /api/cost/by-tool?days=N` — tool-type cost ranking
  - Dashboard Cost Attribution page with expandable project → session drill-down
  - Bar charts for project and tool cost visualization

### Fixed
- Sync datetime format mismatch: daemon stored space-separated timestamps while watermark used ISO 'T' format, causing sessions to never re-sync after initial upload. Fixed with `datetime()` SQL comparison and normalized watermark storage.

### Previously Added
- MCP-Daemon bridge: daemon reads MCP notes/sessions tables and includes semantic data in cloud sync
  - Session enrichment: daemon correlates MCP sessions by `cwd` to attach `task` and `files` to synced sessions
  - Notes sync: MCP shared notes flow through daemon → cloud (privacy level 2+)
  - Graceful fallback: `hasMcpTable()` check prevents crashes when MCP tables don't exist
- Cloud notes storage: `cloud_notes` table in D1 with upsert-by-project-key semantics
- Notes API: `GET /api/notes?project_slug=&session_id=` for querying synced notes
- Usage daily API: `GET /api/usage/daily?days=N` for daily token aggregation
- Session summary generation via Cloudflare Workers AI (Llama 3.1 8B)
- Full-text search across events and notes (`GET /api/search` with UNION ALL)
- Dashboard enhancements:
  - Session detail: task card, files list, linked notes section, AI summary with Generate button
  - Sessions list: summary column, project filtering (`?project=slug`)
  - Usage page: daily tokens bar chart (last 14 days)
  - Search page: keyword search with highlighting, note results with badge
- Email login with 6-digit verification code (Resend)
- `SyncNote` type in shared package, `shapeNoteForSync()` privacy filter

### Changed
- Local daemon (`@agentshow/daemon`) for automatic Claude Code session monitoring
  - Session discovery from `~/.claude/sessions/*.json`
  - Incremental JSONL conversation parsing with byte-offset tracking
  - Token usage, tool call, and content extraction
  - PID-based session lifecycle management (discovered → active → ended)
  - SQLite storage with daemon-specific tables (WAL mode, shared DB)
  - HTTP API on `localhost:45677` (health, sessions, stats, projects)
  - launchd integration for macOS auto-start
- Claude Code skill (`agentshow`) for in-session queries (/peers, /stats, /projects, /history)
- Daemon types in shared package: ClaudeSessionMeta, ConversationEvent, TokenUsage, DaemonSession, MessageRecord
- Cloud sync module in daemon with privacy levels (0-3) and exponential backoff
- Config system (`~/.agentshow/config.json`) for cloud URL, token, and privacy settings
- Cloudflare Worker backend (`@agentshow/worker`) for self-deployable cloud dashboard
  - D1 database with sessions, events, users, API tokens, sync watermarks
  - REST API: sync, sessions, projects, stats endpoints
  - GitHub OAuth + API token authentication (Bearer + Cookie JWT)
  - Vanilla JS SPA dashboard: sessions list, session detail, projects, usage, settings, login
  - Deploy instructions for Cloudflare Workers + D1
- Product direction: from MCP-only to Daemon + Skill + Cloud architecture
- Reorganized docs into current + archive structure

## [0.1.0] - 2026-04-02

### Added
- Local MCP Server for multi-session coordination
- Project identification via `.agentshow.json`
- 6 MCP tools: register_status, get_peers, share_note, get_notes, delete_note, get_project_history
- SQLite storage with WAL mode for concurrent access
- Automatic session lifecycle management
- Example configuration for Claude Code
