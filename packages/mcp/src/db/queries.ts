import type Database from 'better-sqlite3'
import type {
  NoteRecord,
  SessionHistoryRecord,
  SessionRecord,
} from '@agentshow/shared'

type SessionInsertRecord = Omit<SessionRecord, 'started_at' | 'last_heartbeat'>
type SessionUpdateFields = Partial<
  Pick<SessionRecord, 'task' | 'files' | 'status' | 'last_heartbeat'>
>
type TimeSearchOptions = {
  since?: string
  search?: string
}

type ActiveSessionsSummaryRow = {
  project_id: string
  project_name: string
  active_sessions: number
  notes_count: number
}

type NoteUpsertResult = {
  id: number
  status: 'created' | 'updated'
}

type SessionHistoryInsertRecord = Omit<SessionHistoryRecord, 'ended_at'>

export function insertSession(
  db: Database.Database,
  record: SessionInsertRecord,
): void {
  db.prepare(
    `
      INSERT INTO sessions (
        id, project_id, project_name, cwd, task, files, conversation_path, status
      ) VALUES (
        @id, @project_id, @project_name, @cwd, @task, @files, @conversation_path, @status
      )
    `,
  ).run(record)
}

export function updateSession(
  db: Database.Database,
  id: string,
  updates: SessionUpdateFields,
): void {
  const entries = Object.entries(updates).filter(([, value]) => value !== undefined)

  if (entries.length === 0) {
    return
  }

  const assignments = entries.map(([key]) => `${key} = @${key}`).join(', ')
  const params = Object.fromEntries(entries)

  db.prepare(`UPDATE sessions SET ${assignments} WHERE id = @id`).run({
    id,
    ...params,
  })
}

export function getActiveSessionsByProject(
  db: Database.Database,
  projectId: string,
  excludeSessionId?: string,
): SessionRecord[] {
  if (excludeSessionId) {
    return db
      .prepare(
        `
          SELECT *
          FROM sessions
          WHERE project_id = ?
            AND status = 'active'
            AND id != ?
          ORDER BY started_at ASC
        `,
      )
      .all(projectId, excludeSessionId) as SessionRecord[]
  }

  return db
    .prepare(
      `
        SELECT *
        FROM sessions
        WHERE project_id = ?
          AND status = 'active'
        ORDER BY started_at ASC
      `,
    )
    .all(projectId) as SessionRecord[]
}

export function getActiveSessionsSummary(
  db: Database.Database,
): ActiveSessionsSummaryRow[] {
  return db
    .prepare(
      `
        WITH note_counts AS (
          SELECT project_id, COUNT(*) AS notes_count
          FROM notes
          GROUP BY project_id
        ),
        active_projects AS (
          SELECT
            s.project_id,
            s.project_name,
            COUNT(*) AS active_sessions,
            COALESCE(MAX(n.notes_count), 0) AS notes_count
          FROM sessions s
          LEFT JOIN note_counts n ON n.project_id = s.project_id
          WHERE s.status = 'active'
          GROUP BY s.project_id, s.project_name
        ),
        history_only_projects AS (
          SELECT
            h.project_id,
            h.project_name,
            0 AS active_sessions,
            COALESCE(n.notes_count, 0) AS notes_count
          FROM session_history h
          LEFT JOIN note_counts n ON n.project_id = h.project_id
          WHERE NOT EXISTS (
            SELECT 1
            FROM sessions s
            WHERE s.project_id = h.project_id
              AND s.status = 'active'
          )
          GROUP BY h.project_id, h.project_name, n.notes_count
        )
        SELECT *
        FROM active_projects
        UNION ALL
        SELECT *
        FROM history_only_projects
        ORDER BY active_sessions DESC, project_name ASC
      `,
    )
    .all() as ActiveSessionsSummaryRow[]
}

export function markInactive(db: Database.Database, sessionId: string): void {
  db.prepare(
    `
      UPDATE sessions
      SET status = 'inactive',
          last_heartbeat = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
  ).run(sessionId)
}

export function markStaleSessionsInactive(
  db: Database.Database,
  timeoutMs: number,
): string[] {
  const cutoff = new Date(Date.now() - timeoutMs).toISOString()
  const staleSessionRows = db
    .prepare(
      `
        SELECT id
        FROM sessions
        WHERE status = 'active'
          AND datetime(last_heartbeat) < datetime(?)
      `,
    )
    .all(cutoff) as Array<{ id: string }>

  if (staleSessionRows.length === 0) {
    return []
  }

  db.prepare(
    `
      UPDATE sessions
      SET status = 'inactive'
      WHERE status = 'active'
        AND datetime(last_heartbeat) < datetime(?)
    `,
  ).run(cutoff)

  return staleSessionRows.map((row) => row.id)
}

export function upsertNote(
  db: Database.Database,
  projectId: string,
  sessionId: string | null,
  key: string,
  content: string,
): NoteUpsertResult {
  return db.transaction(() => {
    const existing = db
      .prepare(
        `
          SELECT id
          FROM notes
          WHERE project_id = ?
            AND key = ?
        `,
      )
      .get(projectId, key) as { id: number } | undefined

    if (existing) {
      db.prepare(
        `
          UPDATE notes
          SET session_id = ?,
              content = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
      ).run(sessionId, content, existing.id)

      return {
        id: existing.id,
        status: 'updated',
      }
    }

    const result = db.prepare(
      `
        INSERT INTO notes (project_id, session_id, key, content)
        VALUES (?, ?, ?, ?)
      `,
    ).run(projectId, sessionId, key, content)

    return {
      id: Number(result.lastInsertRowid),
      status: 'created',
    }
  })()
}

export function getNotesByProject(
  db: Database.Database,
  projectId: string,
  opts: TimeSearchOptions = {},
): NoteRecord[] {
  const clauses = ['project_id = @projectId']
  const params: Record<string, string> = { projectId }

  if (opts.since) {
    clauses.push('datetime(updated_at) >= datetime(@since)')
    params.since = opts.since
  }

  if (opts.search) {
    clauses.push('(key LIKE @search OR content LIKE @search)')
    params.search = `%${opts.search}%`
  }

  return db
    .prepare(
      `
        SELECT *
        FROM notes
        WHERE ${clauses.join(' AND ')}
        ORDER BY updated_at DESC, id DESC
      `,
    )
    .all(params) as NoteRecord[]
}

export function deleteNote(
  db: Database.Database,
  projectId: string,
  key: string,
): boolean {
  const result = db
    .prepare(
      `
        DELETE FROM notes
        WHERE project_id = ?
          AND key = ?
      `,
    )
    .run(projectId, key)

  return result.changes > 0
}

export function insertSessionHistory(
  db: Database.Database,
  record: SessionHistoryInsertRecord,
): void {
  db.prepare(
    `
      INSERT INTO session_history (
        id, project_id, project_name, task, summary, conversation_path, started_at
      ) VALUES (
        @id, @project_id, @project_name, @task, @summary, @conversation_path, @started_at
      )
    `,
  ).run(record)
}

export function getSessionHistory(
  db: Database.Database,
  projectId: string,
  opts: TimeSearchOptions = {},
): SessionHistoryRecord[] {
  const clauses = ['project_id = @projectId']
  const params: Record<string, string> = { projectId }

  if (opts.since) {
    clauses.push('datetime(ended_at) >= datetime(@since)')
    params.since = opts.since
  }

  if (opts.search) {
    clauses.push(
      '(COALESCE(task, \'\') LIKE @search OR COALESCE(summary, \'\') LIKE @search OR COALESCE(conversation_path, \'\') LIKE @search)',
    )
    params.search = `%${opts.search}%`
  }

  return db
    .prepare(
      `
        SELECT *
        FROM session_history
        WHERE ${clauses.join(' AND ')}
        ORDER BY ended_at DESC, started_at DESC
      `,
    )
    .all(params) as SessionHistoryRecord[]
}
