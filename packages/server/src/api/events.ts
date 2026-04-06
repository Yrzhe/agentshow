import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { getCloudEvents, getCloudSession, getCloudSessionStats, getCloudSessions } from '../db/queries.js'
import { flexAuth, type ServerAppType } from '../middleware/auth.js'
import type { CloudSessionStatus } from '../types.js'

export const eventRoutes = new Hono<ServerAppType>()

eventRoutes.use('*', flexAuth())

eventRoutes.get('/', async (c) => {
  const watch = c.req.query('watch') || 'sessions'
  const sessionId = c.req.query('id')
  const status = c.req.query('status') as CloudSessionStatus | undefined
  const projectSlug = c.req.query('project_slug') ?? undefined
  const db = c.get('db')
  const userId = c.get('userId')

  return streamSSE(c, async (stream) => {
    let lastHash = ''

    const poll = () => {
      if (watch === 'session' && sessionId) {
        const session = getCloudSession(db, userId, sessionId)
        if (!session) return null
        const events = getCloudEvents(db, userId, sessionId, { limit: 50 })
        const stats = getCloudSessionStats(db, userId, sessionId)
        return { session, events, stats }
      }
      const sessions = getCloudSessions(db, userId, {
        status,
        project_slug: projectSlug,
        limit: 100,
        offset: 0,
      })
      return { sessions }
    }

    const hash = (data: unknown) => {
      const str = JSON.stringify(data)
      let h = 0
      for (let i = 0; i < str.length; i++) {
        h = ((h << 5) - h + str.charCodeAt(i)) | 0
      }
      return String(h)
    }

    // Send initial data immediately
    const initial = poll()
    if (initial) {
      lastHash = hash(initial)
      await stream.writeSSE({ data: JSON.stringify(initial), event: watch })
    }

    // Poll every 3s
    while (true) {
      await stream.sleep(3000)
      try {
        const data = poll()
        if (!data) continue
        const currentHash = hash(data)
        if (currentHash !== lastHash) {
          lastHash = currentHash
          await stream.writeSSE({ data: JSON.stringify(data), event: watch })
        }
      } catch {
        break
      }
    }
  })
})
