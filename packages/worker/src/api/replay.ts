import { Hono } from 'hono'
import { getCloudSession, getSessionReplayEvents } from '../db/queries.js'
import type { AppType } from '../index.js'
import { flexAuth } from '../middleware/auth.js'

export const replayRoutes = new Hono<AppType>()
replayRoutes.use('*', flexAuth())

replayRoutes.get('/:sessionId', async (c) => {
  const userId = c.get('userId')
  const sessionId = c.req.param('sessionId')
  const session = await getCloudSession(c.env.DB, userId, sessionId)
  if (!session) {
    return c.json({ error: 'Session not found' }, 404)
  }

  const startedAt = new Date(session.started_at).getTime()
  const events = await getSessionReplayEvents(c.env.DB, userId, sessionId)
  const timeline = events.map((event) => ({
    ...event,
    elapsed_ms: Math.max(0, new Date(event.timestamp).getTime() - startedAt),
  }))
  const unique_tools = Array.from(new Set(timeline.flatMap((event) => splitTools(event.tool_name))))
  const stats = {
    total_events: timeline.length,
    duration_ms: Math.max(0, new Date(session.last_seen_at).getTime() - startedAt),
    total_input_tokens: timeline.reduce((sum, event) => sum + Number(event.input_tokens || 0), 0),
    total_output_tokens: timeline.reduce((sum, event) => sum + Number(event.output_tokens || 0), 0),
    tool_calls: timeline.filter((event) => splitTools(event.tool_name).length > 0).length,
    unique_tools,
  }

  return c.json({
    session: {
      session_id: session.session_id,
      project_slug: session.project_slug,
      started_at: session.started_at,
      last_seen_at: session.last_seen_at,
      status: session.status,
      task: session.task ?? null,
      summary: session.summary ?? null,
    },
    timeline,
    stats,
  })
})

function splitTools(value: string | null): string[] {
  return String(value || '')
    .split(',')
    .map((tool) => tool.trim())
    .filter((tool) => tool.length > 0)
}
