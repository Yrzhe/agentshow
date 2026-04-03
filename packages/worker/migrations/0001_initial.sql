-- Users
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  github_id INTEGER UNIQUE,
  github_login TEXT,
  github_avatar_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- API tokens
CREATE TABLE api_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT 'default',
  token_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  last_used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Synced sessions
CREATE TABLE cloud_sessions (
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  pid INTEGER NOT NULL,
  cwd TEXT NOT NULL,
  project_slug TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'discovered',
  started_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  total_input_tokens INTEGER NOT NULL DEFAULT 0,
  total_output_tokens INTEGER NOT NULL DEFAULT 0,
  tool_calls INTEGER NOT NULL DEFAULT 0,
  synced_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (session_id, user_id)
);

-- Synced events
CREATE TABLE cloud_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  local_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  role TEXT,
  content_preview TEXT,
  tool_name TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  model TEXT,
  timestamp TEXT NOT NULL,
  synced_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Sync watermarks
CREATE TABLE sync_watermarks (
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  last_session_seen_at TEXT,
  last_event_local_id INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, device_id)
);

-- Indexes
CREATE INDEX idx_cloud_sessions_user ON cloud_sessions(user_id);
CREATE INDEX idx_cloud_sessions_project ON cloud_sessions(user_id, project_slug);
CREATE INDEX idx_cloud_sessions_status ON cloud_sessions(user_id, status);
CREATE INDEX idx_cloud_events_session ON cloud_events(user_id, session_id, timestamp);
CREATE INDEX idx_cloud_events_local ON cloud_events(user_id, session_id, local_id);
CREATE INDEX idx_api_tokens_user ON api_tokens(user_id);
CREATE INDEX idx_api_tokens_hash ON api_tokens(token_hash);
