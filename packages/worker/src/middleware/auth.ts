import type { MiddlewareHandler } from 'hono'
import { getCookie } from 'hono/cookie'
import type { AppType } from '../index.js'
import { sha256Hex } from '../lib/hash.js'
import { verifyJwt } from '../lib/jwt.js'

export async function hashToken(token: string): Promise<string> {
  return sha256Hex(token)
}

export function bearerAuth(): MiddlewareHandler<AppType> {
  return async (c, next) => {
    const userId = await getBearerUserId(c)

    if (!userId) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    c.set('userId', userId)
    await next()
  }
}

export function flexAuth(): MiddlewareHandler<AppType> {
  return async (c, next) => {
    const bearerUserId = await getBearerUserId(c)

    if (bearerUserId) {
      c.set('userId', bearerUserId)
      await next()
      return
    }

    const sessionToken = getCookie(c, 'session')
    if (!sessionToken) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const payload = await verifyJwt(sessionToken, c.env.JWT_SECRET)
    if (!payload?.user_id) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    c.set('userId', payload.user_id)
    await next()
  }
}

async function getBearerUserId(
  c: Parameters<MiddlewareHandler<AppType>>[0],
): Promise<string | null> {
  const authorization = c.req.header('Authorization')

  if (!authorization?.startsWith('Bearer ')) {
    return null
  }

  const tokenHash = await hashToken(authorization.slice('Bearer '.length))
  const row = await c.env.DB.prepare(
    'SELECT user_id FROM api_tokens WHERE token_hash = ? LIMIT 1',
  ).bind(tokenHash).first<{ user_id: string }>()

  if (!row?.user_id) {
    return null
  }

  await c.env.DB.prepare(
    "UPDATE api_tokens SET last_used_at = datetime('now') WHERE token_hash = ?",
  ).bind(tokenHash).run()

  return row.user_id
}
