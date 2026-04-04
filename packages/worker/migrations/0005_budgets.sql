CREATE TABLE IF NOT EXISTS budget_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  budget_type TEXT NOT NULL CHECK(budget_type IN ('daily', 'monthly')),
  limit_usd REAL NOT NULL DEFAULT 10.0,
  alert_threshold REAL NOT NULL DEFAULT 0.8,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, budget_type)
);
