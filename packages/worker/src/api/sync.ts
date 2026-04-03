import { Hono } from 'hono'
import type { SyncPayload } from '@agentshow/shared'
import { getWatermark, insertCloudEvents, updateWatermark, upsertCloudNote, upsertCloudSession } from '../db/queries.js'
import type { AppType } from '../index.js'
import { bearerAuth } from '../middleware/auth.js'

export const syncRoutes = new Hono<AppType>()

syncRoutes.use('*', bearerAuth())

syncRoutes.post('/', async (c) => {
  const payload = await c.req.json<SyncPayload>()
  const userId = c.get('userId')
  const watermark = await getWatermark(c.env.DB, userId, payload.device_id)

  for (const session of payload.sessions) {
    await upsertCloudSession(c.env.DB, userId, session, payload.device_id)
  }

  const events = payload.events.filter(
    (event) => event.local_id > watermark.last_event_local_id,
  )

  await insertCloudEvents(c.env.DB, userId, events)

  const notes = payload.notes ?? []
  const projectSlugMap = new Map(
    payload.sessions.map((s) => [s.session_id, s.project_slug]),
  )
  for (const note of notes) {
    const projectSlug = note.session_id
      ? projectSlugMap.get(note.session_id) ?? null
      : null
    await upsertCloudNote(c.env.DB, userId, payload.device_id, note, projectSlug)
  }

  await updateWatermark(
    c.env.DB,
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
