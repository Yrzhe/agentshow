import { Hono } from 'hono'
import { getCloudNotes } from '../db/queries.js'
import { flexAuth, type ServerAppType } from '../middleware/auth.js'

export const notesRoutes = new Hono<ServerAppType>()
notesRoutes.use('*', flexAuth())

notesRoutes.get('/', async (c) => {
  const userId = c.get('userId')
  const project_slug = c.req.query('project_slug')
  const session_id = c.req.query('session_id')
  const notes = getCloudNotes(c.get('db'), userId, { project_slug, session_id })
  return c.json({ notes })
})
