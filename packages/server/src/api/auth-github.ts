import type Database from 'better-sqlite3'
import { getCookie, setCookie } from 'hono/cookie'
import { Hono } from 'hono'
import type { CurrentUser } from '../types.js'
import { sha256Hex } from '../lib/hash.js'
import { signJwt, verifyJwt } from '../lib/jwt.js'
import type { ServerAppType } from '../middleware/auth.js'

const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60

export const authGithubRoutes = new Hono<ServerAppType>()

authGithubRoutes.get('/github', (c) => {
  const env = c.get('env')

  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
    return c.json({ error: 'GitHub OAuth is not configured.' }, 501)
  }

  const redirectUri = new URL('/api/auth/github/callback', c.req.url).href
  const url = new URL('https://github.com/login/oauth/authorize')
  url.searchParams.set('client_id', env.GITHUB_CLIENT_ID)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('scope', 'read:user user:email')
  return c.redirect(url.href)
})

authGithubRoutes.get('/github/callback', async (c) => {
  const env = c.get('env')
  const db = c.get('db')
  const code = c.req.query('code')

  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
    return c.json({ error: 'GitHub OAuth is not configured.' }, 501)
  }

  if (!code) {
    return c.json({ error: 'Missing code' }, 400)
  }

  const accessToken = await exchangeCodeForToken(code, env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET)
  const githubUser = await fetchGitHubUser(accessToken)

  if (!githubUser.email) {
    return c.json({ error: 'Could not retrieve email from GitHub. Please make sure your email is verified.' }, 400)
  }

  if (!isEmailAllowed(githubUser.email, env.ALLOWED_EMAILS)) {
    return c.json({ error: `Email ${githubUser.email} is not in the allowed list. Contact the admin.` }, 403)
  }

  const userId = upsertUserByEmail(db, {
    email: githubUser.email,
    github_id: githubUser.id,
    github_login: githubUser.login,
    github_avatar_url: githubUser.avatar_url,
  })

  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
  const jwt = await signJwt({ user_id: userId, github_login: githubUser.login, exp }, env.JWT_SECRET)

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
  const env = c.get('env')
  const db = c.get('db')

  const bearerUser = await getBearerUser(c.req.header('Authorization'), db)
  if (bearerUser) {
    return c.json(bearerUser)
  }

  const sessionToken = getCookie(c, 'session')
  if (!sessionToken) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const payload = await verifyJwt(sessionToken, env.JWT_SECRET)
  if (!payload) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const user = db.prepare(
    'SELECT id AS user_id, email, github_login, github_avatar_url FROM users WHERE id = ? LIMIT 1',
  ).get(payload.user_id) as CurrentUser | undefined

  return user ? c.json(user) : c.json({ error: 'Unauthorized' }, 401)
})

interface UpsertUserInput {
  email: string
  github_id?: number
  github_login?: string
  github_avatar_url?: string
}

interface GitHubUser {
  id: number
  login: string
  avatar_url: string
  email: string | null
}

interface GitHubEmail {
  email: string
  primary: boolean
  verified: boolean
}

export function upsertUserByEmail(db: Database.Database, input: UpsertUserInput): string {
  const existing = db.prepare(
    'SELECT id FROM users WHERE email = ? LIMIT 1',
  ).get(input.email) as { id: string } | undefined

  const userId = existing?.id ?? crypto.randomUUID()

  db.prepare(
    `
      INSERT INTO users (id, email, github_id, github_login, github_avatar_url)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET
        github_id = COALESCE(excluded.github_id, users.github_id),
        github_login = COALESCE(excluded.github_login, users.github_login),
        github_avatar_url = COALESCE(excluded.github_avatar_url, users.github_avatar_url),
        updated_at = datetime('now')
    `,
  ).run(
    userId,
    input.email,
    input.github_id ?? null,
    input.github_login ?? null,
    input.github_avatar_url ?? null,
  )

  return userId
}

export function isEmailAllowed(email: string, allowedEmails?: string): boolean {
  if (!allowedEmails || allowedEmails.trim() === '') {
    return true
  }

  const allowed = allowedEmails.split(',').map((entry) => entry.trim().toLowerCase())
  return allowed.includes(email.toLowerCase())
}

async function getBearerUser(
  authorization: string | undefined,
  db: Database.Database,
): Promise<CurrentUser | null> {
  if (!authorization?.startsWith('Bearer ')) {
    return null
  }

  const tokenHash = await sha256Hex(authorization.slice('Bearer '.length))
  const user = db.prepare(
    `
      SELECT users.id AS user_id, users.email, users.github_login, users.github_avatar_url
      FROM api_tokens
      JOIN users ON users.id = api_tokens.user_id
      WHERE api_tokens.token_hash = ?
      LIMIT 1
    `,
  ).get(tokenHash) as CurrentUser | undefined

  return user ?? null
}

async function exchangeCodeForToken(
  code: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      code,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  })

  if (!response.ok) {
    throw new Error(`GitHub token exchange failed: ${response.status}`)
  }

  const payload = await response.json() as { access_token?: string }
  if (!payload.access_token) {
    throw new Error('GitHub token exchange did not return access_token')
  }

  return payload.access_token
}

async function fetchGitHubUser(accessToken: string): Promise<GitHubUser> {
  const response = await fetch('https://api.github.com/user', {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': 'AgentShow Server',
    },
  })

  if (!response.ok) {
    throw new Error(`GitHub user fetch failed: ${response.status}`)
  }

  const user = await response.json() as GitHubUser

  if (!user.email) {
    user.email = await fetchPrimaryEmail(accessToken)
  }

  return user
}

async function fetchPrimaryEmail(accessToken: string): Promise<string | null> {
  const response = await fetch('https://api.github.com/user/emails', {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': 'AgentShow Server',
    },
  })

  if (!response.ok) {
    return null
  }

  const emails = await response.json() as GitHubEmail[]
  const primary = emails.find((email) => email.primary && email.verified)
  return primary?.email ?? emails.find((email) => email.verified)?.email ?? null
}
