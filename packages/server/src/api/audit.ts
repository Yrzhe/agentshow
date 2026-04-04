import { Hono } from 'hono'
import {
  getAuditLogs,
  getAuditLogsByFile,
  getAuditStats,
} from '../db/queries.js'
import { flexAuth, type ServerAppType } from '../middleware/auth.js'

export const auditRoutes = new Hono<ServerAppType>()
auditRoutes.use('*', flexAuth())

auditRoutes.get('/', async (c) => {
  const logs = getAuditLogs(c.get('db'), c.get('userId'), {
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
  return c.json({ stats: getAuditStats(c.get('db'), c.get('userId'), Math.min(Number(c.req.query('days')) || 30, 365)) })
})

auditRoutes.get('/file', async (c) => {
  const path = c.req.query('path')
  if (!path) {
    return c.json({ error: 'path is required' }, 400)
  }
  return c.json({ logs: getAuditLogsByFile(c.get('db'), c.get('userId'), path) })
})
