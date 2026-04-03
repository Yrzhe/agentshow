import type Database from 'better-sqlite3'
import type { DaemonSession, DaemonSessionStatus, MessageRecord } from '@agentshow/shared'

type SessionStats = Pick<
  DaemonSession,
  'message_count' | 'total_input_tokens' | 'total_output_tokens' | 'tool_calls'
>
type SessionEventInsert = Omit<MessageRecord, 'id'>
type SessionEventQueryOptions = { limit?: number }

type McpNote = {
  project_id: string
  key: string
  content: string
  session_id: string | null
  created_at: string
  updated_at: string
}

type McpSessionInfo = {
  id: string
  task: string | null
  files: string | null
}

type McpApiNote = {
  key: string
  content: string
  session_id: string | null
  updated_at: string
}

export function upsertDaemonSession(db: Database.Database, session: DaemonSession): void {
  db.prepare(
    `
      INSERT OR REPLACE INTO daemon_sessions (
        session_id, pid, cwd, project_slug, status, started_at, last_seen_at,
        conversation_path, message_count, total_input_tokens, total_output_tokens, tool_calls
      ) VALUES (
        @session_id, @pid, @cwd, @project_slug, @status, @started_at, @last_seen_at,
        @conversation_path, @message_count, @total_input_tokens, @total_output_tokens, @tool_calls
      )
    `,
  ).run(session)
}

export function updateSessionStatus(
  db: Database.Database,
  sessionId: string,
  status: DaemonSessionStatus,
): void {
  db.prepare(
    'UPDATE daemon_sessions SET status = ?, last_seen_at = CURRENT_TIMESTAMP WHERE session_id = ?',
  ).run(status, sessionId)
}

export function updateSessionStats(
  db: Database.Database,
  sessionId: string,
  stats: Partial<SessionStats>,
): void {
  const entries = Object.entries(stats).filter(([, value]) => value !== undefined)
  if (entries.length === 0) {
    return
  }

  const assignments = entries.map(([key]) => `${key} = @${key}`).join(', ')

  db.prepare(
    `UPDATE daemon_sessions SET ${assignments}, last_seen_at = CURRENT_TIMESTAMP WHERE session_id = @sessionId`,
  ).run({ sessionId, ...Object.fromEntries(entries) })
}

export function getDaemonSessionsByStatus(
  db: Database.Database,
  status: DaemonSessionStatus,
): DaemonSession[] {
  return db
    .prepare('SELECT * FROM daemon_sessions WHERE status = ? ORDER BY started_at ASC')
    .all(status) as DaemonSession[]
}

export function getAllDaemonSessions(db: Database.Database): DaemonSession[] {
  return db
    .prepare('SELECT * FROM daemon_sessions ORDER BY started_at ASC')
    .all() as DaemonSession[]
}

export function insertConversationEvents(
  db: Database.Database,
  events: SessionEventInsert[],
): void {
  if (events.length === 0) {
    return
  }

  const insert = db.prepare(
    `
      INSERT INTO conversation_events (
        session_id, type, role, content_preview, tool_name,
        input_tokens, output_tokens, model, timestamp
      ) VALUES (
        @session_id, @type, @role, @content_preview, @tool_name,
        @input_tokens, @output_tokens, @model, @timestamp
      )
    `,
  )

  db.transaction((rows: SessionEventInsert[]) => {
    for (const row of rows) {
      insert.run(row)
    }
  })(events)
}

export function getFileOffset(db: Database.Database, filePath: string): number {
  const row = db
    .prepare('SELECT byte_offset FROM file_offsets WHERE file_path = ?')
    .get(filePath) as { byte_offset: number } | undefined
  return row?.byte_offset ?? 0
}

export function setFileOffset(db: Database.Database, filePath: string, offset: number): void {
  db.prepare(
    `
      INSERT OR REPLACE INTO file_offsets (file_path, byte_offset, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
    `,
  ).run(filePath, offset)
}

export function getSyncState(db: Database.Database, key: string): string | null {
  const row = db
    .prepare('SELECT value FROM sync_state WHERE key = ?')
    .get(key) as { value: string } | undefined

  return row?.value ?? null
}

export function setSyncState(db: Database.Database, key: string, value: string): void {
  db.prepare(
    `
      INSERT OR REPLACE INTO sync_state (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
    `,
  ).run(key, value)
}

export function getSessionsModifiedSince(
  db: Database.Database,
  since: string,
): DaemonSession[] {
  return db
    .prepare(
      `
        SELECT *
        FROM daemon_sessions
        WHERE ? = '' OR datetime(last_seen_at) > datetime(?)
        ORDER BY last_seen_at ASC
      `,
    )
    .all(since, since) as DaemonSession[]
}

export function getEventsAfterLocalId(
  db: Database.Database,
  afterId: number,
  limit: number,
): MessageRecord[] {
  return db
    .prepare(
      `
        SELECT *
        FROM conversation_events
        WHERE id > ?
        ORDER BY id ASC
        LIMIT ?
      `,
    )
    .all(afterId, limit) as MessageRecord[]
}

export function getSessionEvents(
  db: Database.Database,
  sessionId: string,
  opts: SessionEventQueryOptions = {},
): MessageRecord[] {
  return db
    .prepare(
      `
        SELECT *
        FROM conversation_events
        WHERE session_id = ?
        ORDER BY timestamp ASC, id ASC
        LIMIT ?
      `,
    )
    .all(sessionId, opts.limit ?? -1) as MessageRecord[]
}

export function getSessionStats(db: Database.Database, sessionId: string): SessionStats {
  const row = db
    .prepare(
      `
        SELECT message_count, total_input_tokens, total_output_tokens, tool_calls
        FROM daemon_sessions
        WHERE session_id = ?
      `,
    )
    .get(sessionId) as SessionStats | undefined

  return row ?? {
    message_count: 0,
    total_input_tokens: 0,
    total_output_tokens: 0,
    tool_calls: 0,
  }
}

// ============================================================
// MCP Bridge Queries (read from MCP's tables in the same DB)
// ============================================================

export function getMcpNotes(db: Database.Database): McpNote[] {
  if (!hasMcpTable(db, 'notes')) {
    return []
  }
  return db
    .prepare(
      'SELECT project_id, key, content, session_id, created_at, updated_at FROM notes ORDER BY updated_at ASC',
    )
    .all() as McpNote[]
}

export function getMcpNotesModifiedSince(db: Database.Database, since: string): McpNote[] {
  if (!hasMcpTable(db, 'notes')) {
    return []
  }
  if (since === '') {
    return db
      .prepare(
        'SELECT project_id, key, content, session_id, created_at, updated_at FROM notes ORDER BY updated_at ASC',
      )
      .all() as McpNote[]
  }
  return db
    .prepare(
      'SELECT project_id, key, content, session_id, created_at, updated_at FROM notes WHERE datetime(updated_at) > datetime(?) ORDER BY updated_at ASC',
    )
    .all(since) as McpNote[]
}

export function getMcpNotesByProjectSlug(
  db: Database.Database,
  _projectSlug: string,
): McpApiNote[] {
  if (!hasMcpTable(db, 'notes')) {
    return []
  }

  return db
    .prepare(
      'SELECT key, content, session_id, updated_at FROM notes ORDER BY updated_at DESC',
    )
    .all() as McpApiNote[]
}

export function getMcpSessionByCwd(db: Database.Database, cwd: string): McpSessionInfo | null {
  if (!hasMcpTable(db, 'sessions')) {
    return null
  }
  const row = db
    .prepare(
      `
        SELECT id, task, files FROM sessions
        WHERE cwd = ? AND status = 'active'
        ORDER BY last_heartbeat DESC LIMIT 1
      `,
    )
    .get(cwd) as McpSessionInfo | undefined
  return row ?? null
}

function hasMcpTable(db: Database.Database, tableName: string): boolean {
  const row = db
    .prepare("SELECT COUNT(*) as cnt FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { cnt: number }
  return row.cnt > 0
}
