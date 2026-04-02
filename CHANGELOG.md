# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

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
