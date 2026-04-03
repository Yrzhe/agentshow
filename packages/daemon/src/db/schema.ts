import type Database from 'better-sqlite3'

const CREATE_DAEMON_SESSIONS_SQL = `
CREATE TABLE IF NOT EXISTS daemon_sessions (
  session_id TEXT PRIMARY KEY,
  pid INTEGER NOT NULL,
  cwd TEXT NOT NULL,
  project_slug TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  conversation_path TEXT,
  message_count INTEGER NOT NULL DEFAULT 0,
  total_input_tokens INTEGER NOT NULL DEFAULT 0,
  total_output_tokens INTEGER NOT NULL DEFAULT 0,
  tool_calls INTEGER NOT NULL DEFAULT 0
);
`

const CREATE_CONVERSATION_EVENTS_SQL = `
CREATE TABLE IF NOT EXISTS conversation_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  type TEXT NOT NULL,
  role TEXT,
  content_preview TEXT,
  tool_name TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  model TEXT,
  timestamp TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES daemon_sessions(session_id)
);
`

const CREATE_FILE_OFFSETS_SQL = `
CREATE TABLE IF NOT EXISTS file_offsets (
  file_path TEXT PRIMARY KEY,
  byte_offset INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
`

const CREATE_SYNC_STATE_SQL = `
CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`

const CREATE_INDEXES_SQL = `
CREATE INDEX IF NOT EXISTS idx_daemon_sessions_status ON daemon_sessions(status);
CREATE INDEX IF NOT EXISTS idx_daemon_sessions_project_slug ON daemon_sessions(project_slug);
CREATE INDEX IF NOT EXISTS idx_conversation_events_session_timestamp ON conversation_events(session_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_conversation_events_type ON conversation_events(type);
`

export function initDaemonSchema(db: Database.Database): void {
  db.transaction(() => {
    db.exec(CREATE_DAEMON_SESSIONS_SQL)
    db.exec(CREATE_CONVERSATION_EVENTS_SQL)
    db.exec(CREATE_FILE_OFFSETS_SQL)
    db.exec(CREATE_SYNC_STATE_SQL)
    db.exec(CREATE_INDEXES_SQL)
  })()
}
