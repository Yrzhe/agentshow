import type Database from 'better-sqlite3'
import type { MiddlewareHandler } from 'hono'
import { getCookie } from 'hono/cookie'
import type { ServerEnv } from '../env.js'
import { sha256Hex } from '../lib/hash.js'
import { verifyJwt } from '../lib/jwt.js'

export type ServerAppType = {
  Variables: {
    db: Database.Database
    env: ServerEnv
    userId: string
  }
}

export async function hashToken(token: string): Promise<string> {
  return sha256Hex(token)
}

export function bearerAuth(): MiddlewareHandler<ServerAppType> {
  return async (c, next) => {
    const userId = await getBearerUserId(c)

    if (!userId) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    c.set('userId', userId)
    await next()
  }
}

export function flexAuth(): MiddlewareHandler<ServerAppType> {
  return async (c, next) => {
    const env = c.get('env') as ServerEnv
    const bearerUserId = await getBearerUserId(c)

    if (bearerUserId) {
      c.set('userId', bearerUserId)
      await next()
      return
    }

    const sessionToken = getCookie(c, 'session')
    if (sessionToken) {
      const payload = await verifyJwt(sessionToken, env.JWT_SECRET)
      if (payload?.user_id) {
        c.set('userId', payload.user_id)
        await next()
        return
      }
    }

    // Local dev mode: auto-login when no OAuth is configured
    if (!env.GITHUB_CLIENT_ID?.trim()) {
      const db = c.get('db') as Database.Database
      let row = db.prepare('SELECT id FROM users LIMIT 1').get() as { id: string } | undefined
      if (!row) {
        const id = 'local-dev-' + Date.now()
        db.prepare(
          "INSERT INTO users (id, email, github_login, created_at) VALUES (?, 'local@dev', 'local-dev', datetime('now'))",
        ).run(id)
        row = { id }
      }
      c.set('userId', row.id)
      await next()
      return
    }

    return c.json({ error: 'Unauthorized' }, 401)
  }
}

async function getBearerUserId(
  c: Parameters<MiddlewareHandler<ServerAppType>>[0],
): Promise<string | null> {
  const db = c.get('db') as Database.Database
  const authorization = c.req.header('Authorization')

  if (!authorization?.startsWith('Bearer ')) {
    return null
  }

  const tokenHash = await hashToken(authorization.slice('Bearer '.length))
  const row = db.prepare(
    'SELECT user_id FROM api_tokens WHERE token_hash = ? LIMIT 1',
  ).get(tokenHash) as { user_id: string } | undefined

  if (!row?.user_id) {
    return null
  }

  db.prepare(
    "UPDATE api_tokens SET last_used_at = datetime('now') WHERE token_hash = ?",
  ).run(tokenHash)

  return row.user_id
}
