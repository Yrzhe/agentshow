# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- **SSE real-time updates**: Sessions list and session detail pages now use Server-Sent Events (`/api/events`) instead of polling — data pushes to browser within 3s of change
- SSE endpoint supports filtered subscriptions: `?watch=sessions&status=active` or `?watch=session&id=xxx`

### Removed
- `packages/worker/` — Cloudflare Worker package removed (project deploys to VPS, not CF Workers)
- Frontend `setInterval` polling replaced by SSE (sessions list 30s → 3s, session detail 10s → 3s)

### Fixed
- Type errors in `replay.ts` — `Record<string, unknown>` spread now properly typed

### Added (prior)
- Dashboard responsive design & mobile UX overhaul
  - Hamburger menu overlay: sidebar now overlays content with fixed positioning + backdrop, instead of pushing content down
  - Sessions mobile card layout: table converts to vertical card stack below 920px
  - Project card stats horizontal: Sessions/Tokens/Updated displayed inline instead of 3-row grid
  - Project card path scrollable: long cwd paths now horizontally scrollable instead of truncated
  - Mobile audit: all table pages (cost attribution, audit, replay) get responsive treatment with proper overflow scrolling
  - Card grid auto-fill: medium-width breakpoint uses `auto-fill, minmax(240px, 1fr)` for natural flow
- Replay deduplication: server-side filtering of incremental streaming events (keeps only final version)
- Replay Follow button: toggle auto-scroll with yellow active indicator, hidden scrollbar in follow mode
- Replay fixed layout: timeline scrolls internally with fixed-height container, controls pinned at bottom
- Replay elapsed time: client-side calculation from timestamps when API returns 0
- Replay Markdown fix: correct newline regex in String.raw template for proper line break rendering
- Cache-Control: no-cache on dashboard static assets (app.js, styles.css) to prevent stale browser cache
- Sessions page: project filter clear button (yellow badge with x)
- Projects page: "ended" badge for inactive projects, active-first sorting by last activity

### Changed
- Dashboard redesigned with light brutalist theme (Paper MCP designs implemented)
  - Auto-creates `local-dev` user on first request if no users exist
  - Applies to both `/api/auth/me` and `flexAuth()` middleware
  - Safe for production: only activates when OAuth is unconfigured
- Session replay Markdown rendering: code blocks, inline code, bold, headers, lists
- Session replay constant-speed playback (0.8s/msg at 1x, not real elapsed time)
  - Progress bar and seek now map linearly to event count

### Changed
- Dashboard redesigned with light brutalist theme (Paper MCP designs implemented)
  - Color palette: cream background #FDFBF5, Space Mono monospace font, warm yellow #D4A017 accent
  - All borders changed to dashed style, no rounded corners (border-radius: 0)
  - Grouped sidebar navigation: Monitor / Analyze / Manage / System
  - Session Replay moved to sidebar nav with session picker page
  - All inline dark-theme colors replaced with CSS variable references
  - Login page updated for light theme
  - Server package dashboard synced with worker
- Skill enhanced with `/dashboard` (opens cloud dashboard) and `/sync-status` commands

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
- Webhook integration (Step 7c): session end notifications to external services
  - `webhook_configs` + `webhook_deliveries` tables (migration 0006)
  - CRUD API: `GET/POST/PUT/DELETE /api/webhooks`, `GET /:id/deliveries`, `POST /:id/test`
  - Async webhook delivery engine with 10s timeout, secret header, delivery logging
  - Auto-trigger on session end during sync
  - Dashboard Webhooks page with config management and delivery history
- Team spaces (Step 6a): multi-user team collaboration
  - `teams`, `team_members`, `team_invites` tables (migration 0007)
  - Team CRUD, member management with admin/member roles
  - Email-based invite system with accept flow
  - Team sessions and usage aggregation queries
  - Dashboard Teams page with team list, detail, and member management
- Team reports (Step 6b): weekly team productivity reports
  - `GET /api/teams/:id/report?week=YYYY-MM-DD` — per-member session/token/cost breakdown
  - Dashboard weekly report with member contribution table and cost bar chart
- VPS deployment documentation (`docs/VPS_DEPLOYMENT.md`)
  - Docker and non-Docker deployment guides
  - Nginx reverse proxy, systemd service, backup, and security recommendations
- Audit logs (Step 6c): track agent decisions for traceability
  - `audit_logs` table with action types: file_edit, command_exec, pr_create, git_push, etc.
  - Auto-extraction from sync events (tool_name → action_type mapping)
  - `GET /api/audit` with filtering by session, project, action_type, file_path
  - `GET /api/audit/file?path=X` for per-file operation history
  - Dashboard Audit Log page with filters, stats cards, and action timeline
- Cross-session workflows (Step 7b): automated session chaining
  - `workflows` + `workflow_runs` tables (migration 0009)
  - Workflow engine with trigger matching and variable template substitution
  - Support for webhook and daemon_api action types
  - Auto-trigger on session end alongside webhooks
  - CRUD API + test trigger endpoint
  - Dashboard Workflows page with config, execution history
- Session replay (Step 7a): timeline playback of agent conversations
  - `GET /api/replay/:sessionId` returns full timeline with elapsed_ms offsets
  - Dashboard replay player with play/pause, speed control (1x/2x/5x/10x), progress bar
  - User/assistant/tool message bubbles with fade-in animation
  - "Replay" button added to session detail page
  - Responsive replay controls with keyboard shortcuts

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
