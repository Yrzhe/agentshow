import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { authGithubRoutes } from './api/auth-github.js'
import { authEmailRoutes } from './api/auth-email.js'
import { projectRoutes } from './api/projects.js'
import { sessionRoutes } from './api/sessions.js'
import { syncRoutes } from './api/sync.js'
import { tokenRoutes } from './api/tokens.js'
import { dashboardRoutes } from './dashboard/serve.js'

export type Bindings = {
  DB: D1Database
  GITHUB_CLIENT_ID: string
  GITHUB_CLIENT_SECRET: string
  JWT_SECRET: string
  ALLOWED_EMAILS?: string    // 逗号分隔的邮箱白名单，空则不限制
  RESEND_API_KEY?: string    // 可选，启用邮件登录
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
app.route('/api/sessions', sessionRoutes)
app.route('/api/projects', projectRoutes)
app.route('/', dashboardRoutes)

export default app
