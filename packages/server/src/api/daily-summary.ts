import { Hono } from 'hono'
import { flexAuth, type ServerAppType } from '../middleware/auth.js'

type DailySummarySession = {
  session_id: string
  project_slug: string
  cwd: string
  status: string
  started_at: string
  last_seen_at: string
  message_count: number
  total_input_tokens: number
  total_output_tokens: number
  tool_calls: number
  summary: string | null
  task: string | null
}

type DailySummaryProject = {
  project_slug: string
  cwd: string
  sessions: DailySummarySession[]
  totals: {
    input_tokens: number
    output_tokens: number
    tool_calls: number
  }
}

export const dailySummaryRoutes = new Hono<ServerAppType>()
dailySummaryRoutes.use('*', flexAuth())

dailySummaryRoutes.get('/', async (c) => {
  const db = c.get('db')
  const userId = c.get('userId')
  const date = c.req.query('date') ?? new Date().toISOString().slice(0, 10)

  const sessions = db.prepare(
    `
      SELECT session_id, project_slug, cwd, status, started_at, last_seen_at,
             message_count, total_input_tokens, total_output_tokens, tool_calls, summary, task
      FROM cloud_sessions
      WHERE user_id = ? AND date(started_at) = ?
      ORDER BY project_slug, started_at ASC
    `,
  ).all(userId, date) as DailySummarySession[]

  const projects = new Map<string, DailySummaryProject>()
  for (const session of sessions) {
    const slug = session.project_slug
    if (!projects.has(slug)) {
      projects.set(slug, {
        project_slug: slug,
        cwd: session.cwd,
        sessions: [],
        totals: { input_tokens: 0, output_tokens: 0, tool_calls: 0 },
      })
    }

    const project = projects.get(slug)
    if (!project) {
      continue
    }

    project.sessions.push(session)
    project.totals.input_tokens += session.total_input_tokens
    project.totals.output_tokens += session.total_output_tokens
    project.totals.tool_calls += session.tool_calls
  }

  return c.json({
    date,
    projects: [...projects.values()],
    totals: {
      sessions: sessions.length,
      input_tokens: sessions.reduce((sum, session) => sum + session.total_input_tokens, 0),
      output_tokens: sessions.reduce((sum, session) => sum + session.total_output_tokens, 0),
    },
  })
})
