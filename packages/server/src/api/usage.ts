import { Hono } from 'hono'
import { getTokensByDay } from '../db/queries.js'
import { flexAuth, type ServerAppType } from '../middleware/auth.js'

export const usageDailyRoutes = new Hono<ServerAppType>()
usageDailyRoutes.use('*', flexAuth())

usageDailyRoutes.get('/daily', async (c) => {
  const userId = c.get('userId')
  const days = Math.min(Number(c.req.query('days')) || 14, 90)
  const data = getTokensByDay(c.get('db'), userId, days)
  return c.json({ daily: data })
})
