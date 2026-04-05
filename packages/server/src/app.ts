import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { fileURLToPath } from 'node:url'
import { createDatabase } from './db/connection.js'
import { runMigrations } from './db/migrate.js'
import { loadEnv } from './env.js'
import { authEmailRoutes } from './api/auth-email.js'
import { authGithubRoutes } from './api/auth-github.js'
import { auditRoutes } from './api/audit.js'
import { budgetRoutes } from './api/budget.js'
import { costAttributionRoutes } from './api/cost-attribution.js'
import { dailySummaryRoutes } from './api/daily-summary.js'
import { notesRoutes } from './api/notes.js'
import { projectRoutes } from './api/projects.js'
import { replayRoutes } from './api/replay.js'
import { searchRoutes } from './api/search.js'
import { sessionRoutes } from './api/sessions.js'
import { summaryRoutes } from './api/summary.js'
import { syncRoutes } from './api/sync.js'
import { webhookRoutes } from './api/webhooks.js'
import { teamRoutes } from './api/teams.js'
import { tokenRoutes } from './api/tokens.js'
import { usageDailyRoutes } from './api/usage.js'
import { dashboardRoutes } from './dashboard/serve.js'
import { workflowRoutes } from './api/workflows.js'
import type { ServerAppType } from './middleware/auth.js'

const env = loadEnv()
const db = createDatabase(env.DATABASE_PATH)
runMigrations(db, fileURLToPath(new URL('../migrations', import.meta.url)))

const app = new Hono<ServerAppType>()
app.use('/api/*', cors())
app.use('*', async (c, next) => {
  c.set('db', db)
  c.set('env', env)
  await next()
})
app.get('/api/health', (c) => c.json({ status: 'ok' }))

// Dev login: sets session cookie for the first user in DB (local testing only)
app.get('/api/auth/dev-login', async (c) => {
  const { signJwt } = await import('./lib/jwt.js')
  const { setCookie } = await import('hono/cookie')
  const localDb = c.get('db')
  const localEnv = c.get('env')
  const user = localDb.prepare('SELECT id, email, github_login FROM users LIMIT 1').get() as { id: string; email: string; github_login: string } | undefined
  if (!user) return c.json({ error: 'No users in DB. Seed one first.' }, 404)
  const exp = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60
  const token = await signJwt({ user_id: user.id, github_login: user.github_login ?? 'dev', exp }, localEnv.JWT_SECRET)
  setCookie(c, 'session', token, { path: '/', httpOnly: true, sameSite: 'Lax', maxAge: 7 * 24 * 60 * 60 })
  return c.redirect('/')
})
app.route('/api/auth/tokens', tokenRoutes)
app.route('/api/auth', authGithubRoutes)
app.route('/api/auth', authEmailRoutes)
app.route('/api/sync', syncRoutes)
app.route('/api/sessions', summaryRoutes)
app.route('/api/sessions', sessionRoutes)
app.route('/api/daily-summary', dailySummaryRoutes)
app.route('/api/projects', projectRoutes)
app.route('/api/replay', replayRoutes)
app.route('/api/teams', teamRoutes)
app.route('/api/search', searchRoutes)
app.route('/api/notes', notesRoutes)
app.route('/api/audit', auditRoutes)
app.route('/api/usage', usageDailyRoutes)
app.route('/api/budget', budgetRoutes)
app.route('/api/webhooks', webhookRoutes)
app.route('/api/workflows', workflowRoutes)
app.route('/api/cost', costAttributionRoutes)
app.route('/', dashboardRoutes)

export { app }
