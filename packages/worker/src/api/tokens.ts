import { getCookie } from 'hono/cookie'
import { Hono } from 'hono'
import type { ApiToken } from '../types.js'
import { generateApiToken, generateId } from '../lib/id.js'
import { verifyJwt } from '../lib/jwt.js'
import { sha256Hex } from '../lib/hash.js'
import type { AppType } from '../index.js'

export const tokenRoutes = new Hono<AppType>()

tokenRoutes.use('*', async (c, next) => {
  const token = getCookie(c, 'session')
  if (!token) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const payload = await verifyJwt(token, c.env.JWT_SECRET)
  if (!payload) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  c.set('userId', payload.user_id)
  await next()
})

tokenRoutes.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    `
      SELECT id, name, prefix, created_at, last_used_at
      FROM api_tokens
      WHERE user_id = ?
      ORDER BY created_at DESC, id ASC
    `,
  ).bind(c.get('userId')).all<ApiToken>()

  return c.json(results ?? [])
})

tokenRoutes.post('/', async (c) => {
  const body = await c.req.json().catch(() => ({})) as { name?: string }
  const token = generateApiToken()
  const prefix = token.slice(0, 8)
  const name = body.name?.trim() || 'default'

  await c.env.DB.prepare(
    `
      INSERT INTO api_tokens (id, user_id, name, token_hash, prefix)
      VALUES (?, ?, ?, ?, ?)
    `,
  ).bind(
    generateId(),
    c.get('userId'),
    name,
    await sha256Hex(token),
    prefix,
  ).run()

  const created = await c.env.DB.prepare(
    'SELECT id, name, prefix, created_at, last_used_at FROM api_tokens WHERE user_id = ? AND prefix = ? ORDER BY created_at DESC LIMIT 1',
  ).bind(c.get('userId'), prefix).first<ApiToken>()

  return c.json({
    id: created?.id ?? '',
    name,
    prefix,
    token,
  }, 201)
})

tokenRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id')
  const existing = await c.env.DB.prepare(
    'SELECT id FROM api_tokens WHERE id = ? AND user_id = ? LIMIT 1',
  ).bind(id, c.get('userId')).first<{ id: string }>()

  if (!existing) {
    return c.json({ error: 'Not Found' }, 404)
  }

  await c.env.DB.prepare('DELETE FROM api_tokens WHERE id = ? AND user_id = ?').bind(id, c.get('userId')).run()
  return c.json({ status: 'deleted' })
})
