import { getCookie, setCookie } from 'hono/cookie'
import { Hono } from 'hono'
import type { CurrentUser } from '../types.js'
import { exchangeCodeForToken, fetchGitHubUser } from '../lib/github-oauth.js'
import { generateId } from '../lib/id.js'
import { signJwt, verifyJwt } from '../lib/jwt.js'
import { sha256Hex } from '../lib/hash.js'
import type { AppType } from '../index.js'

const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60

export const authGithubRoutes = new Hono<AppType>()

authGithubRoutes.get('/github', (c) => {
  const redirectUri = new URL('/api/auth/github/callback', c.req.url).href
  const url = new URL('https://github.com/login/oauth/authorize')
  url.searchParams.set('client_id', c.env.GITHUB_CLIENT_ID)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('scope', 'read:user user:email')
  return c.redirect(url.href)
})

authGithubRoutes.get('/github/callback', async (c) => {
  const code = c.req.query('code')
  if (!code) {
    return c.json({ error: 'Missing code' }, 400)
  }

  const accessToken = await exchangeCodeForToken(code, c.env.GITHUB_CLIENT_ID, c.env.GITHUB_CLIENT_SECRET)
  const githubUser = await fetchGitHubUser(accessToken)

  if (!githubUser.email) {
    return c.json({ error: 'Could not retrieve email from GitHub. Please make sure your email is verified.' }, 400)
  }

  if (!isEmailAllowed(githubUser.email, c.env.ALLOWED_EMAILS)) {
    return c.json({ error: 'Your email is not in the allowed list. Contact the admin.' }, 403)
  }

  const userId = await upsertUserByEmail(c.env.DB, {
    email: githubUser.email,
    github_id: githubUser.id,
    github_login: githubUser.login,
    github_avatar_url: githubUser.avatar_url,
  })

  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
  const jwt = await signJwt({ user_id: userId, github_login: githubUser.login, exp }, c.env.JWT_SECRET)

  setCookie(c, 'session', jwt, {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  })

  return c.redirect('/')
})

authGithubRoutes.get('/me', async (c) => {
  const bearerUser = await getBearerUser(c.req.header('Authorization'), c.env.DB)
  if (bearerUser) {
    return c.json(bearerUser)
  }

  const sessionToken = getCookie(c, 'session')
  if (!sessionToken) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const payload = await verifyJwt(sessionToken, c.env.JWT_SECRET)
  if (!payload) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const user = await c.env.DB.prepare(
    'SELECT id AS user_id, email, github_login, github_avatar_url FROM users WHERE id = ? LIMIT 1',
  ).bind(payload.user_id).first<CurrentUser>()

  return user ? c.json(user) : c.json({ error: 'Unauthorized' }, 401)
})

interface UpsertUserInput {
  email: string
  github_id?: number
  github_login?: string
  github_avatar_url?: string
}

export async function upsertUserByEmail(db: D1Database, input: UpsertUserInput): Promise<string> {
  const existing = await db.prepare(
    'SELECT id FROM users WHERE email = ? LIMIT 1',
  ).bind(input.email).first<{ id: string }>()

  const userId = existing?.id ?? generateId()

  await db.prepare(
    `
      INSERT INTO users (id, email, github_id, github_login, github_avatar_url)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET
        github_id = COALESCE(excluded.github_id, users.github_id),
        github_login = COALESCE(excluded.github_login, users.github_login),
        github_avatar_url = COALESCE(excluded.github_avatar_url, users.github_avatar_url),
        updated_at = datetime('now')
    `,
  ).bind(userId, input.email, input.github_id ?? null, input.github_login ?? null, input.github_avatar_url ?? null).run()

  return userId
}

export function isEmailAllowed(email: string, allowedEmails?: string): boolean {
  if (!allowedEmails || allowedEmails.trim() === '') {
    return true
  }

  const allowed = allowedEmails.split(',').map((e) => e.trim().toLowerCase())
  return allowed.includes(email.toLowerCase())
}

async function getBearerUser(authorization: string | undefined, db: D1Database): Promise<CurrentUser | null> {
  if (!authorization?.startsWith('Bearer ')) {
    return null
  }

  const tokenHash = await sha256Hex(authorization.slice('Bearer '.length))
  const user = await db.prepare(
    `
      SELECT users.id AS user_id, users.email, users.github_login, users.github_avatar_url
      FROM api_tokens
      JOIN users ON users.id = api_tokens.user_id
      WHERE api_tokens.token_hash = ?
      LIMIT 1
    `,
  ).bind(tokenHash).first<CurrentUser>()

  return user ?? null
}
