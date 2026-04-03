import { Hono } from 'hono'
import { getTokensByDay } from '../db/queries.js'
import type { AppType } from '../index.js'
import { flexAuth } from '../middleware/auth.js'

export const usageDailyRoutes = new Hono<AppType>()
usageDailyRoutes.use('*', flexAuth())

usageDailyRoutes.get('/daily', async (c) => {
  const userId = c.get('userId')
  const days = Math.min(Number(c.req.query('days')) || 14, 90)
  const data = await getTokensByDay(c.env.DB, userId, days)
  return c.json({ daily: data })
})
