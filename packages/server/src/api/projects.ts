import { Hono } from 'hono'
import { getCloudProjects } from '../db/queries.js'
import { flexAuth, type ServerAppType } from '../middleware/auth.js'

export const projectRoutes = new Hono<ServerAppType>()

projectRoutes.use('*', flexAuth())

projectRoutes.get('/', async (c) => {
  const projects = getCloudProjects(c.get('db'), c.get('userId'))
  return c.json({ projects })
})
