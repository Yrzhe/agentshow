import { getCookie } from 'hono/cookie'
import { Hono } from 'hono'
import type { ApiToken } from '../types.js'
import { generateApiToken, generateId } from '../lib/id.js'
import { verifyJwt } from '../lib/jwt.js'
import { sha256Hex } from '../lib/hash.js'
import type { ServerAppType } from '../middleware/auth.js'

export const tokenRoutes = new Hono<ServerAppType>()

tokenRoutes.use('*', async (c, next) => {
  const token = getCookie(c, 'session')
  if (!token) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const payload = await verifyJwt(token, c.get('env').JWT_SECRET)
  if (!payload) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  c.set('userId', payload.user_id)
  await next()
})

tokenRoutes.get('/', async (c) => {
  const results = c.get('db').prepare(
    `
      SELECT id, name, prefix, created_at, last_used_at
      FROM api_tokens
      WHERE user_id = ?
      ORDER BY created_at DESC, id ASC
    `,
  ).all(c.get('userId')) as ApiToken[]

  return c.json(results)
})

tokenRoutes.post('/', async (c) => {
  const body = await c.req.json().catch(() => ({})) as { name?: string }
  const token = generateApiToken()
  const prefix = token.slice(0, 8)
  const name = body.name?.trim() || 'default'
  const db = c.get('db')

  db.prepare(
    `
      INSERT INTO api_tokens (id, user_id, name, token_hash, prefix)
      VALUES (?, ?, ?, ?, ?)
    `,
  ).run(
    generateId(),
    c.get('userId'),
    name,
    await sha256Hex(token),
    prefix,
  )

  const created = db.prepare(
    'SELECT id, name, prefix, created_at, last_used_at FROM api_tokens WHERE user_id = ? AND prefix = ? ORDER BY created_at DESC LIMIT 1',
  ).get(c.get('userId'), prefix) as ApiToken | undefined

  return c.json({
    id: created?.id ?? '',
    name,
    prefix,
    token,
  }, 201)
})

tokenRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id')
  const db = c.get('db')
  const existing = db.prepare(
    'SELECT id FROM api_tokens WHERE id = ? AND user_id = ? LIMIT 1',
  ).get(id, c.get('userId')) as { id: string } | undefined

  if (!existing) {
    return c.json({ error: 'Not Found' }, 404)
  }

  db.prepare('DELETE FROM api_tokens WHERE id = ? AND user_id = ?').run(id, c.get('userId'))
  return c.json({ status: 'deleted' })
})
