import { Hono } from 'hono'
import { searchCloudEvents } from '../db/queries.js'
import { flexAuth, type ServerAppType } from '../middleware/auth.js'

export const searchRoutes = new Hono<ServerAppType>()

searchRoutes.use('*', flexAuth())

searchRoutes.get('/', async (c) => {
  const q = c.req.query('q')?.trim()

  if (!q) {
    return c.json({ results: [], total: 0 })
  }

  const limit = Math.min(Number(c.req.query('limit')) || 20, 100)
  const offset = Number(c.req.query('offset')) || 0
  const data = searchCloudEvents(c.get('db'), c.get('userId'), q, { limit, offset })

  return c.json(data)
})
