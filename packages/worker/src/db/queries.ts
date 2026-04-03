import type {
  CloudNote,
  CloudProject,
  CloudSession,
  CloudSessionStatus,
  SearchResult,
  SyncEvent,
  SyncNote,
  SyncSession,
} from '../types.js'

type SessionQueryOptions = {
  status?: CloudSessionStatus
  project_slug?: string
  limit?: number
  offset?: number
}

type EventQueryOptions = { limit?: number }

type Watermark = {
  last_session_seen_at: string | null
  last_event_local_id: number
}

type SessionStats = Pick<
  CloudSession,
  'total_input_tokens' | 'total_output_tokens' | 'tool_calls' | 'message_count'
>

export async function upsertCloudSession(
  db: D1Database,
  userId: string,
  session: SyncSession,
  deviceId: string,
): Promise<void> {
  await db.prepare(
    `
      INSERT OR REPLACE INTO cloud_sessions (
        session_id, user_id, device_id, pid, cwd, project_slug, status,
        started_at, last_seen_at, message_count, total_input_tokens,
        total_output_tokens, tool_calls, task, files, synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `,
  ).bind(
    session.session_id,
    userId,
    deviceId,
    session.pid,
    session.cwd,
    session.project_slug,
    session.status,
    session.started_at,
    session.last_seen_at,
    session.message_count,
    session.total_input_tokens,
    session.total_output_tokens,
    session.tool_calls,
    session.task ?? null,
    session.files ?? null,
  ).run()
}

export async function getCloudSessions(
  db: D1Database,
  userId: string,
  opts: SessionQueryOptions = {},
): Promise<CloudSession[]> {
  const conditions = ['user_id = ?']
  const values: Array<string | number> = [userId]

  if (opts.status) {
    conditions.push('status = ?')
    values.push(opts.status)
  }
  if (opts.project_slug) {
    conditions.push('project_slug = ?')
    values.push(opts.project_slug)
  }

  const { results } = await db.prepare(
    `
      SELECT *
      FROM cloud_sessions
      WHERE ${conditions.join(' AND ')}
      ORDER BY last_seen_at DESC, session_id ASC
      LIMIT ? OFFSET ?
    `,
  ).bind(...values, opts.limit ?? 100, opts.offset ?? 0).all<CloudSession>()

  return results ?? []
}

export async function getCloudSession(
  db: D1Database,
  userId: string,
  sessionId: string,
): Promise<CloudSession | null> {
  const row = await db.prepare(
    'SELECT * FROM cloud_sessions WHERE user_id = ? AND session_id = ? LIMIT 1',
  ).bind(userId, sessionId).first<CloudSession>()

  return row ?? null
}

export async function getCloudSessionStats(
  db: D1Database,
  userId: string,
  sessionId: string,
): Promise<SessionStats> {
  const row = await db.prepare(
    `
      SELECT total_input_tokens, total_output_tokens, tool_calls, message_count
      FROM cloud_sessions
      WHERE user_id = ? AND session_id = ?
      LIMIT 1
    `,
  ).bind(userId, sessionId).first<SessionStats>()

  return row ?? {
    total_input_tokens: 0,
    total_output_tokens: 0,
    tool_calls: 0,
    message_count: 0,
  }
}

export async function updateSessionSummary(
  db: D1Database,
  userId: string,
  sessionId: string,
  summary: string,
): Promise<void> {
  await db.prepare(
    'UPDATE cloud_sessions SET summary = ? WHERE session_id = ? AND user_id = ?',
  ).bind(summary, sessionId, userId).run()
}

export async function insertCloudEvents(
  db: D1Database,
  userId: string,
  events: SyncEvent[],
): Promise<void> {
  if (events.length === 0) {
    return
  }

  await db.batch(events.map((event) =>
    db.prepare(
      `
        INSERT INTO cloud_events (
          user_id, session_id, local_id, type, role, content_preview,
          tool_name, input_tokens, output_tokens, model, timestamp, synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `,
    ).bind(
      userId,
      event.session_id,
      event.local_id,
      event.type,
      event.role,
      event.content_preview ?? null,
      event.tool_name,
      event.input_tokens,
      event.output_tokens,
      event.model,
      event.timestamp,
    ),
  ))
}

export async function getCloudEvents(
  db: D1Database,
  userId: string,
  sessionId: string,
  opts: EventQueryOptions = {},
): Promise<SyncEvent[]> {
  const { results } = await db.prepare(
    `
      SELECT local_id, session_id, type, role, content_preview, tool_name,
             input_tokens, output_tokens, model, timestamp
      FROM cloud_events
      WHERE user_id = ? AND session_id = ?
        AND type IN ('user', 'assistant', 'system')
      ORDER BY local_id DESC
      LIMIT ?
    `,
  ).bind(userId, sessionId, opts.limit ?? 100).all<SyncEvent>()

  return (results ?? []).reverse()
}

export async function getCloudProjects(db: D1Database, userId: string): Promise<CloudProject[]> {
  const { results } = await db.prepare(
    `
      SELECT
        project_slug,
        MIN(cwd) AS cwd,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_sessions,
        COUNT(*) AS total_sessions,
        SUM(total_input_tokens) AS total_input_tokens,
        SUM(total_output_tokens) AS total_output_tokens,
        SUM(tool_calls) AS total_tool_calls,
        MAX(last_seen_at) AS last_activity
      FROM cloud_sessions
      WHERE user_id = ?
      GROUP BY project_slug
      ORDER BY last_activity DESC, project_slug ASC
    `,
  ).bind(userId).all<CloudProject>()

  return results ?? []
}

export async function getWatermark(
  db: D1Database,
  userId: string,
  deviceId: string,
): Promise<Watermark> {
  const row = await db.prepare(
    `
      SELECT last_session_seen_at, last_event_local_id
      FROM sync_watermarks
      WHERE user_id = ? AND device_id = ?
      LIMIT 1
    `,
  ).bind(userId, deviceId).first<Watermark>()

  return row ?? { last_session_seen_at: null, last_event_local_id: 0 }
}

export async function updateWatermark(
  db: D1Database,
  userId: string,
  deviceId: string,
  sessionSeenAt: string | null,
  eventLocalId: number,
): Promise<void> {
  await db.prepare(
    `
      INSERT OR REPLACE INTO sync_watermarks (
        user_id, device_id, last_session_seen_at, last_event_local_id, updated_at
      ) VALUES (?, ?, ?, ?, datetime('now'))
    `,
  ).bind(userId, deviceId, sessionSeenAt, eventLocalId).run()
}

export async function searchCloudEvents(
  db: D1Database,
  userId: string,
  query: string,
  opts: { limit: number; offset: number },
): Promise<{ results: SearchResult[]; total: number }> {
  const countRow = await db.prepare(
    `
      SELECT (
        (SELECT COUNT(*) FROM cloud_events e
         JOIN cloud_sessions s ON s.session_id = e.session_id AND s.user_id = e.user_id
         WHERE e.user_id = ?
           AND (
             e.content_preview LIKE '%' || ? || '%'
             OR e.tool_name LIKE '%' || ? || '%'
             OR s.cwd LIKE '%' || ? || '%'
             OR s.project_slug LIKE '%' || ? || '%'
           ))
        +
        (SELECT COUNT(*) FROM cloud_notes
         WHERE user_id = ?
           AND (key LIKE '%' || ? || '%' OR content LIKE '%' || ? || '%'))
      ) AS total
    `,
  ).bind(userId, query, query, query, query, userId, query, query).first<{ total: number }>()

  const { results } = await db.prepare(
    `
      SELECT * FROM (
        SELECT
          e.local_id,
          e.session_id,
          e.type,
          e.role,
          e.content_preview,
          e.tool_name,
          e.model,
          e.timestamp,
          e.input_tokens,
          e.output_tokens,
          s.cwd,
          s.project_slug,
          s.status AS session_status,
          'event' AS source_type
        FROM cloud_events e
        JOIN cloud_sessions s ON s.session_id = e.session_id AND s.user_id = e.user_id
        WHERE e.user_id = ?
          AND (
            e.content_preview LIKE '%' || ? || '%'
            OR e.tool_name LIKE '%' || ? || '%'
            OR s.cwd LIKE '%' || ? || '%'
            OR s.project_slug LIKE '%' || ? || '%'
          )

        UNION ALL

        SELECT
          n.id AS local_id,
          COALESCE(n.session_id, '') AS session_id,
          'note' AS type,
          NULL AS role,
          n.content AS content_preview,
          n.key AS tool_name,
          NULL AS model,
          n.updated_at AS timestamp,
          0 AS input_tokens,
          0 AS output_tokens,
          '' AS cwd,
          COALESCE(n.project_slug, n.project_id) AS project_slug,
          '' AS session_status,
          'note' AS source_type
        FROM cloud_notes n
        WHERE n.user_id = ?
          AND (n.key LIKE '%' || ? || '%' OR n.content LIKE '%' || ? || '%')
      )
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `,
  ).bind(
    userId, query, query, query, query,
    userId, query, query,
    opts.limit, opts.offset,
  ).all<SearchResult>()

  return {
    results: results ?? [],
    total: Number(countRow?.total ?? 0),
  }
}

export async function upsertCloudNote(
  db: D1Database,
  userId: string,
  deviceId: string,
  note: SyncNote,
  projectSlug: string | null,
): Promise<void> {
  await db.prepare(`
    INSERT OR REPLACE INTO cloud_notes (
      user_id, device_id, project_id, project_slug, key, content,
      session_id, created_at, updated_at, synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).bind(
    userId, deviceId, note.project_id, projectSlug, note.key, note.content,
    note.session_id, note.created_at, note.updated_at,
  ).run()
}

export async function getCloudNotes(
  db: D1Database,
  userId: string,
  opts: { project_slug?: string | null | undefined; session_id?: string | null | undefined; limit?: number },
): Promise<CloudNote[]> {
  const conditions = ['user_id = ?']
  const values: Array<string | number> = [userId]
  if (opts.project_slug) { conditions.push('project_slug = ?'); values.push(opts.project_slug) }
  if (opts.session_id) { conditions.push('session_id = ?'); values.push(opts.session_id) }
  const { results } = await db.prepare(`
    SELECT * FROM cloud_notes WHERE ${conditions.join(' AND ')}
    ORDER BY updated_at DESC LIMIT ?
  `).bind(...values, opts.limit ?? 50).all<CloudNote>()
  return results ?? []
}

export async function getTokensByDay(
  db: D1Database,
  userId: string,
  days: number = 14,
): Promise<Array<{ date: string; input_tokens: number; output_tokens: number }>> {
  const { results } = await db.prepare(`
    SELECT
      date(started_at) AS date,
      SUM(total_input_tokens) AS input_tokens,
      SUM(total_output_tokens) AS output_tokens
    FROM cloud_sessions
    WHERE user_id = ? AND started_at >= datetime('now', '-' || ? || ' days')
    GROUP BY date(started_at)
    ORDER BY date ASC
  `).bind(userId, days).all()
  return (results ?? []) as Array<{ date: string; input_tokens: number; output_tokens: number }>
}
