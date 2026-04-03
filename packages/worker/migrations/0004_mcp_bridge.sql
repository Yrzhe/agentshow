-- Add MCP semantic fields to cloud_sessions
ALTER TABLE cloud_sessions ADD COLUMN task TEXT;
ALTER TABLE cloud_sessions ADD COLUMN files TEXT;

-- Notes table
CREATE TABLE cloud_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  project_slug TEXT,
  key TEXT NOT NULL,
  content TEXT NOT NULL,
  session_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  synced_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, project_id, key)
);

CREATE INDEX idx_cloud_notes_user_project ON cloud_notes(user_id, project_id);
CREATE INDEX idx_cloud_notes_user_slug ON cloud_notes(user_id, project_slug);
