import { Hono } from 'hono'
import { getCloudEvents, getCloudSession, getCloudSessionStats, getCloudSessions } from '../db/queries.js'
import type { AppType } from '../index.js'
import { flexAuth } from '../middleware/auth.js'
import type { CloudSessionStatus } from '../types.js'

export const sessionRoutes = new Hono<AppType>()

sessionRoutes.use('*', flexAuth())

sessionRoutes.get('/', async (c) => {
  const sessions = await getCloudSessions(c.env.DB, c.get('userId'), {
    status: c.req.query('status') as CloudSessionStatus | undefined,
    project_slug: c.req.query('project_slug') ?? undefined,
    limit: parseNumber(c.req.query('limit'), 100),
    offset: parseNumber(c.req.query('offset'), 0),
  })

  return c.json({ sessions })
})

sessionRoutes.get('/:id', async (c) => {
  const sessionId = c.req.param('id')
  const session = await getCloudSession(c.env.DB, c.get('userId'), sessionId)

  if (!session) {
    return c.json({ error: 'Not found' }, 404)
  }

  const limit = parseNumber(c.req.query('limit'), 50)
  const events = await getCloudEvents(c.env.DB, c.get('userId'), sessionId, { limit })
  return c.json({ session, events })
})

sessionRoutes.get('/:id/stats', async (c) => {
  const stats = await getCloudSessionStats(c.env.DB, c.get('userId'), c.req.param('id'))
  return c.json(stats)
})

function parseNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}
