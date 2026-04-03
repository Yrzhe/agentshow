import type { CloudProject, CloudSession, CloudSessionStatus, SyncEvent, SyncSession } from '../types.js'

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
        total_output_tokens, tool_calls, synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
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
      ORDER BY timestamp ASC, local_id ASC
      LIMIT ?
    `,
  ).bind(userId, sessionId, opts.limit ?? 100).all<SyncEvent>()

  return results ?? []
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
