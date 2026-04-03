# Feature: MCP-Daemon Bridge + Dashboard Enhancement

## Overview

AgentShow has a structural disconnect: MCP captures semantic data (task, notes, files) but it never reaches the cloud/dashboard. Daemon captures behavioral data (tokens, events) and syncs it. This plan bridges the two layers and enhances the dashboard to display unified data.

**Root cause**: MCP and Daemon share the same SQLite file (`~/.agentshow/agentshow.db`) but use different tables with incompatible ID systems. No code reads across this boundary.

---

## Phase 1: Daemon reads MCP tables → enrich sync payload

### Stage 1A: MCP Notes Reader (Daemon)
**Goal**: Daemon reads MCP's `notes` table and includes notes in sync payload.
**Files to modify**:
- `packages/daemon/src/db/queries.ts` — add `getMcpNotes()`, `getMcpNotesModifiedSince()`
- `packages/shared/src/types.ts` — add `SyncNote` type
- `packages/daemon/src/sync/cloud-sync.ts` — add notes to SyncPayload
- `packages/shared/src/privacy.ts` — add `shapeNoteForSync()` (level >= 2)
**Success Criteria**: `SyncPayload.notes` contains MCP notes with project_id, key, content
**Status**: Not Started

### Stage 1B: MCP Session Enrichment (Daemon)
**Goal**: Daemon correlates its sessions with MCP sessions by `cwd` and extracts `task` + `files`.
**Files to modify**:
- `packages/daemon/src/db/queries.ts` — add `getMcpSessionByCwd(cwd, timeRange)`
- `packages/daemon/src/tracker/session-tracker.ts` — after discovering active session, query MCP sessions table for matching cwd, extract task/files
- `packages/shared/src/types.ts` — add `task` and `files` to SyncSession
- `packages/daemon/src/sync/cloud-sync.ts` — include task/files in shaped sessions
**Correlation logic**:
```sql
SELECT id, task, files FROM sessions
WHERE cwd = ? AND status = 'active'
ORDER BY last_heartbeat DESC LIMIT 1
```
**Success Criteria**: Daemon session has MCP task/files attached before sync
**Status**: Not Started

### Stage 1C: Tests for Phase 1
**Goal**: Unit tests for MCP table reads + correlation logic.
**Files to create**:
- `packages/daemon/tests/mcp-bridge.test.ts`
**Test cases**:
- Read notes from MCP table (empty, single, multiple)
- Correlate daemon session with MCP session by cwd
- No correlation when cwd doesn't match
- Privacy filtering on notes (level 0/1 = no notes, level 2+ = include)
- task/files enrichment on SyncSession
**Status**: Not Started

---

## Phase 2: Worker receives + stores enriched data

### Stage 2A: Cloud Schema Migration
**Goal**: Add tables/columns for task, files, notes.
**Files to create**:
- `packages/worker/migrations/0004_mcp_bridge.sql`
**SQL**:
```sql
-- Add MCP semantic fields to cloud_sessions
ALTER TABLE cloud_sessions ADD COLUMN task TEXT;
ALTER TABLE cloud_sessions ADD COLUMN files TEXT;

-- Notes table
CREATE TABLE cloud_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  project_slug TEXT NOT NULL,
  key TEXT NOT NULL,
  content TEXT NOT NULL,
  session_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  synced_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, project_id, key)
);

CREATE INDEX idx_cloud_notes_user_project ON cloud_notes(user_id, project_slug);
CREATE INDEX idx_cloud_notes_user_session ON cloud_notes(user_id, session_id);
```
**Status**: Not Started

### Stage 2B: Sync API accepts notes + task/files
**Goal**: Worker's POST /api/sync receives and stores enriched payload.
**Files to modify**:
- `packages/worker/src/types.ts` — add `SyncNote` type, add task/files to SyncSession
- `packages/worker/src/db/queries.ts` — add `upsertCloudNote()`, update `upsertCloudSession()` to save task/files
- `packages/worker/src/api/sync.ts` — process `payload.notes`
**Success Criteria**: After sync, cloud_sessions has task/files, cloud_notes has notes
**Status**: Not Started

### Stage 2C: Notes API endpoints
**Goal**: Dashboard can query notes.
**Files to modify**:
- `packages/worker/src/db/queries.ts` — add `getCloudNotes()`, `getCloudNotesBySession()`
- `packages/worker/src/index.ts` — register notes routes
**Files to create**:
- `packages/worker/src/api/notes.ts`
**Endpoints**:
```
GET /api/notes?project_slug=xxx              → all notes for project
GET /api/notes?session_id=xxx                → notes linked to session
GET /api/search?q=xxx  (extend existing)     → also search cloud_notes.content
```
**Status**: Not Started

### Stage 2D: Tests for Phase 2
**Goal**: Worker tests for new schema + sync + API.
**Files to modify**:
- `packages/worker/tests/sync-api.test.ts` — add tests for notes + task/files in sync
**Files to create**:
- `packages/worker/tests/notes-api.test.ts`
**Status**: Not Started

---

## Phase 3: Dashboard enhancement

### Stage 3A: Session Detail — show task, files, notes
**Goal**: Session detail page displays agent intent alongside behavioral data.
**Files to modify**:
- `packages/worker/src/dashboard/pages/session-detail.ts`
**Changes**:
- Add "Task" card showing session.task (if present)
- Add "Files" section with file list (parsed from JSON)
- Add "Notes" section listing notes linked to this session
- Fetch notes from `/api/notes?session_id=xxx`
**Status**: Not Started

### Stage 3B: Projects page — show notes count + recent task
**Goal**: Project cards show semantic context.
**Files to modify**:
- `packages/worker/src/dashboard/pages/projects.ts`
- `packages/worker/src/db/queries.ts` — extend `getCloudProjects()` to include notes count + latest task
**Changes**:
- Each project card shows: notes count, most recent task description
- Click project → filter sessions by project_slug (fix existing broken link)
**Status**: Not Started

### Stage 3C: Usage page — time dimension
**Goal**: Token usage shown over time, not just cumulative totals.
**Files to modify**:
- `packages/worker/src/dashboard/pages/usage.ts`
- `packages/worker/src/db/queries.ts` — add `getTokensByDay(userId, days)`
**Changes**:
- Add daily token chart (last 14 days) — simple bar chart with vanilla JS
- Add model breakdown (tokens per model)
- Fix: use `/api/projects` endpoint instead of loading all sessions client-side
**Status**: Not Started

### Stage 3D: Summary improvements
**Goal**: Better summary generation and rendering.
**Files to modify**:
- `packages/worker/src/api/summary.ts` — increase event limit to 200, input to 8000 chars
- `packages/worker/src/dashboard/pages/session-detail.ts` — render markdown (basic: bold, code, lists)
**Status**: Not Started

### Stage 3E: Search covers notes
**Goal**: Search results include notes content.
**Files to modify**:
- `packages/worker/src/db/queries.ts` — extend `searchCloudEvents()` to UNION with cloud_notes search
- `packages/worker/src/dashboard/pages/search.ts` — render note results differently (show key + content)
**Status**: Not Started

---

## Phase 4: Daemon API + Skill unification

### Stage 4A: Daemon API exposes MCP data
**Goal**: Daemon HTTP API includes notes and task info.
**Files to modify**:
- `packages/daemon/src/api/routes.ts` — add `/notes` endpoint, enrich `/sessions/:id` with task/files
- `packages/daemon/src/db/queries.ts` — add `getMcpNotesByProjectSlug()`
**New endpoints**:
```
GET /notes?project_slug=xxx   → MCP notes for project
GET /sessions/:id             → now includes task, files from MCP
```
**Status**: Not Started

### Stage 4B: Skill update
**Goal**: Skill commands return unified data.
**Files to modify**:
- `packages/skill/SKILL.md` — add `/notes` command, update `/peers` to show task info
**Status**: Not Started

---

## Dependency Graph

```
1A (Notes Reader)  ──┐
                     ├──→  2A (Migration)  ──→  2B (Sync API)  ──→  2C (Notes API)
1B (Session Enrich) ─┘                                                    │
                                                                          ↓
1C (Tests Ph1) ─────────────────────────────────────────────  2D (Tests Ph2)
                                                                          │
                                                                          ↓
                                                              3A (Session Detail)
                                                              3B (Projects)
                                                              3C (Usage)
                                                              3D (Summary)
                                                              3E (Search + Notes)
                                                                          │
                                                                          ↓
                                                              4A (Daemon API)
                                                              4B (Skill)
```

**Parallelism**: 1A + 1B can run in parallel. 3A-3E can run in parallel after 2C. 4A + 4B can run in parallel.

---

## Engineer Assignment

### Engineer A: Backend bridge (Phase 1 + 2)
- 1A: MCP Notes Reader
- 1B: MCP Session Enrichment
- 1C: Tests for Phase 1
- 2A: Cloud Schema Migration
- 2B: Sync API accepts notes + task/files
- 2C: Notes API endpoints
- 2D: Tests for Phase 2

### Engineer B: Dashboard + Skill (Phase 3 + 4)
- 3A: Session Detail — task, files, notes
- 3B: Projects page — notes + recent task
- 3C: Usage page — time dimension
- 3D: Summary improvements
- 3E: Search covers notes
- 4A: Daemon API exposes MCP data
- 4B: Skill update

**Note**: Engineer B depends on Engineer A completing 2C (Notes API) before starting 3A. Engineer B can start 3C and 3D immediately (no dependency).

---

## Estimated Code Changes

| Stage | New LOC | Modified LOC | Tests |
|-------|---------|-------------|-------|
| 1A | ~40 | ~30 | ~30 |
| 1B | ~30 | ~40 | ~30 |
| 2A | ~25 | — | — |
| 2B | ~20 | ~40 | ~20 |
| 2C | ~60 | ~20 | ~30 |
| 3A | — | ~80 | — |
| 3B | — | ~50 | — |
| 3C | — | ~100 | — |
| 3D | — | ~40 | — |
| 3E | — | ~50 | — |
| 4A | ~40 | ~30 | — |
| 4B | — | ~20 | — |
| **Total** | **~215** | **~500** | **~110** |

---

## Verification

After all stages:
1. `pnpm build` passes
2. `pnpm test` passes (all existing + new tests)
3. Daemon startup: `node packages/daemon/dist/main.js`
4. Open Claude Code, run `register_status` + `share_note`
5. `curl localhost:45677/sessions` shows session with `task` field
6. `curl localhost:45677/notes` shows shared notes
7. Dashboard session detail shows task, files, linked notes
8. Dashboard usage page shows daily token chart
9. Search returns notes alongside events
10. Skill `/peers` shows task info, `/notes` shows project notes
