import { Hono } from 'hono'
import { getCloudSession, getSessionReplayEvents } from '../db/queries.js'
import { flexAuth, type ServerAppType } from '../middleware/auth.js'

export const replayRoutes = new Hono<ServerAppType>()
replayRoutes.use('*', flexAuth())

replayRoutes.get('/:sessionId', async (c) => {
  const db = c.get('db')
  const userId = c.get('userId')
  const sessionId = c.req.param('sessionId')
  const session = getCloudSession(db, userId, sessionId)
  if (!session) {
    return c.json({ error: 'Session not found' }, 404)
  }

  const startedAt = new Date(session.started_at).getTime()
  const rawEvents = getSessionReplayEvents(db, userId, sessionId)
  const events = deduplicateStreamingEvents(rawEvents)
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

function deduplicateStreamingEvents(events: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const result: Array<Record<string, unknown>> = []
  for (let i = 0; i < events.length; i++) {
    const current = events[i]
    const next = events[i + 1]
    const currentContent = String(current.content_preview || '')
    const nextContent = String(next?.content_preview || '')
    if (
      next &&
      current.role === next.role &&
      current.role === 'assistant' &&
      currentContent.length > 0 &&
      nextContent.startsWith(currentContent)
    ) {
      continue
    }
    result.push(current)
  }
  return result
}

function splitTools(value: string | null): string[] {
  return String(value || '')
    .split(',')
    .map((tool) => tool.trim())
    .filter((tool) => tool.length > 0)
}
