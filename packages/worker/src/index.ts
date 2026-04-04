import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { auditRoutes } from './api/audit.js'
import { authGithubRoutes } from './api/auth-github.js'
import { authEmailRoutes } from './api/auth-email.js'
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

export type Bindings = {
  DB: D1Database
  AI: Ai
  GITHUB_CLIENT_ID: string
  GITHUB_CLIENT_SECRET: string
  JWT_SECRET: string
  ALLOWED_EMAILS?: string
  RESEND_API_KEY?: string
}

export type Variables = {
  userId: string
}

export type AppType = {
  Bindings: Bindings
  Variables: Variables
}

export const app = new Hono<AppType>()

app.use('/api/*', cors())

app.get('/api/health', (c) => c.json({ status: 'ok' }))
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

export default app
