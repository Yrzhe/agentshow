import { Hono } from 'hono'
import {
  getAuditLogs,
  getAuditLogsByFile,
  getAuditStats,
} from '../db/queries.js'
import type { AppType } from '../index.js'
import { flexAuth } from '../middleware/auth.js'

export const auditRoutes = new Hono<AppType>()
auditRoutes.use('*', flexAuth())

auditRoutes.get('/', async (c) => {
  const logs = await getAuditLogs(c.env.DB, c.get('userId'), {
    session_id: c.req.query('session_id') ?? undefined,
    project_slug: c.req.query('project') ?? undefined,
    action_type: c.req.query('action_type') ?? undefined,
    file_path: c.req.query('file') ?? undefined,
    limit: Math.min(Number(c.req.query('limit')) || 100, 200),
    offset: Number(c.req.query('offset')) || 0,
  })
  return c.json({ logs })
})

auditRoutes.get('/stats', async (c) => {
  return c.json({ stats: await getAuditStats(c.env.DB, c.get('userId'), Math.min(Number(c.req.query('days')) || 30, 365)) })
})

auditRoutes.get('/file', async (c) => {
  const path = c.req.query('path')
  if (!path) {
    return c.json({ error: 'path is required' }, 400)
  }
  return c.json({ logs: await getAuditLogsByFile(c.env.DB, c.get('userId'), path) })
})
