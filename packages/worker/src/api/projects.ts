import { Hono } from 'hono'
import { getCloudProjects } from '../db/queries.js'
import type { AppType } from '../index.js'
import { flexAuth } from '../middleware/auth.js'

export const projectRoutes = new Hono<AppType>()

projectRoutes.use('*', flexAuth())

projectRoutes.get('/', async (c) => {
  const projects = await getCloudProjects(c.env.DB, c.get('userId'))
  return c.json({ projects })
})
