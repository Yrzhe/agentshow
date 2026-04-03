import type Database from 'better-sqlite3'
import { SCHEMA_VERSION } from '@agentshow/shared'

const CREATE_SESSIONS_TABLE_SQL = `
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    project_name TEXT NOT NULL,
    cwd TEXT NOT NULL,
    task TEXT,
    files TEXT,
    conversation_path TEXT,
    status TEXT DEFAULT 'active',
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_heartbeat DATETIME DEFAULT CURRENT_TIMESTAMP
);
`

const CREATE_NOTES_TABLE_SQL = `
CREATE TABLE notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    session_id TEXT,
    key TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, key)
);
`

const CREATE_SESSION_HISTORY_TABLE_SQL = `
CREATE TABLE session_history (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    project_name TEXT NOT NULL,
    task TEXT,
    summary TEXT,
    conversation_path TEXT,
    started_at DATETIME,
    ended_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`

const CREATE_INDEXES_SQL = `
CREATE INDEX idx_sessions_project ON sessions(project_id, status);
CREATE INDEX idx_notes_project ON notes(project_id);
CREATE INDEX idx_history_project ON session_history(project_id, ended_at);
`

export function initSchema(db: Database.Database): void {
  const currentVersion = db.pragma('user_version', { simple: true }) as number

  if (currentVersion > SCHEMA_VERSION) {
    console.warn(
      `Database schema version ${currentVersion} is newer than supported version ${SCHEMA_VERSION}`,
    )
  }

  if (currentVersion === 0) {
    db.transaction(() => {
      db.exec(CREATE_SESSIONS_TABLE_SQL)
      db.exec(CREATE_NOTES_TABLE_SQL)
      db.exec(CREATE_SESSION_HISTORY_TABLE_SQL)
      db.exec(CREATE_INDEXES_SQL)
      db.pragma(`user_version = ${SCHEMA_VERSION}`)
    })()
    return
  }

  if (currentVersion < SCHEMA_VERSION) {
    db.pragma(`user_version = ${SCHEMA_VERSION}`)
  }
}
