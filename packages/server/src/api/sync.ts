import { Hono } from 'hono'
import type { SyncPayload } from '@agentshow/shared'
import { getWatermark, insertCloudEvents, updateWatermark, upsertCloudNote, upsertCloudSession } from '../db/queries.js'
import { bearerAuth, type ServerAppType } from '../middleware/auth.js'

export const syncRoutes = new Hono<ServerAppType>()

syncRoutes.use('*', bearerAuth())

syncRoutes.post('/', async (c) => {
  const payload = await c.req.json<SyncPayload>()
  const userId = c.get('userId')
  const db = c.get('db')
  const watermark = getWatermark(db, userId, payload.device_id)

  for (const session of payload.sessions) {
    upsertCloudSession(db, userId, session, payload.device_id)
  }

  const events = payload.events.filter(
    (event) => event.local_id > watermark.last_event_local_id,
  )

  insertCloudEvents(db, userId, events)

  const notes = payload.notes ?? []
  const projectSlugMap = new Map(
    payload.sessions.map((s) => [s.session_id, s.project_slug]),
  )
  for (const note of notes) {
    const projectSlug = note.session_id
      ? projectSlugMap.get(note.session_id) ?? null
      : null
    upsertCloudNote(db, userId, payload.device_id, note, projectSlug)
  }

  updateWatermark(
    db,
    userId,
    payload.device_id,
    payload.sessions[payload.sessions.length - 1]?.last_seen_at ?? watermark.last_session_seen_at,
    events[events.length - 1]?.local_id ?? watermark.last_event_local_id,
  )

  return c.json({
    status: 'ok' as const,
    accepted_sessions: payload.sessions.length,
    accepted_events: events.length,
    accepted_notes: notes.length,
    server_time: new Date().toISOString(),
  })
})
