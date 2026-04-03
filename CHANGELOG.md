# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
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

### Changed
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
