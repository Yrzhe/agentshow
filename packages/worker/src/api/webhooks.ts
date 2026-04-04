import { Hono } from 'hono'
import {
  createWebhookConfig,
  deleteWebhookConfig,
  getWebhookConfigById,
  getWebhookConfigs,
  getWebhookDeliveries,
  insertWebhookDelivery,
  updateWebhookConfig,
} from '../db/queries.js'
import type { AppType } from '../index.js'
import { flexAuth } from '../middleware/auth.js'
import { sendWebhook } from '../lib/webhook-sender.js'

type WebhookBody = {
  name?: string
  url?: string
  secret?: string | null
  events?: string[] | string
  is_active?: boolean | number
}

const DEFAULT_EVENTS = 'session.ended'

function parseWebhookId(value: string): number | null {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

function normalizeEvents(input: WebhookBody['events']): string {
  const list = Array.isArray(input) ? input : String(input ?? DEFAULT_EVENTS).split(',')
  const normalized = list.map((item) => String(item).trim()).filter(Boolean)
  return normalized.length > 0 ? normalized.join(',') : DEFAULT_EVENTS
}

function parseCreateBody(body: WebhookBody) {
  const name = String(body.name ?? 'Default').trim() || 'Default'
  const url = String(body.url ?? '').trim()
  if (!url) {
    return null
  }
  return { name, url, secret: body.secret ? String(body.secret) : null, events: normalizeEvents(body.events) }
}

function mergeWebhookBody(current: Awaited<ReturnType<typeof getWebhookConfigById>>, body: WebhookBody) {
  if (!current) {
    return null
  }
  return {
    name: String(body.name ?? current.name).trim() || current.name,
    url: String(body.url ?? current.url).trim() || current.url,
    secret: body.secret === undefined ? current.secret : (body.secret ? String(body.secret) : null),
    events: normalizeEvents(body.events ?? current.events),
    is_active: body.is_active === undefined ? current.is_active : (Number(body.is_active) ? 1 : 0),
  }
}

async function withLatestDeliveries(db: D1Database, userId: string) {
  const hooks = await getWebhookConfigs(db, userId)
  return Promise.all(hooks.map(async (hook) => ({
    ...hook,
    latest_delivery: (await getWebhookDeliveries(db, hook.id, 1))[0] ?? null,
  })))
}

export const webhookRoutes = new Hono<AppType>()
webhookRoutes.use('*', flexAuth())

webhookRoutes.get('/', async (c) => {
  const webhooks = await withLatestDeliveries(c.env.DB, c.get('userId'))
  return c.json({ webhooks })
})

webhookRoutes.post('/', async (c) => {
  const parsed = parseCreateBody(await c.req.json<WebhookBody>())
  if (!parsed) {
    return c.json({ error: 'Invalid url' }, 400)
  }
  const id = await createWebhookConfig(c.env.DB, c.get('userId'), parsed)
  const webhook = await getWebhookConfigById(c.env.DB, c.get('userId'), id)
  return c.json({ webhook }, 201)
})

webhookRoutes.put('/:id', async (c) => {
  const webhookId = parseWebhookId(c.req.param('id'))
  if (!webhookId) {
    return c.json({ error: 'Invalid webhook id' }, 400)
  }
  const current = await getWebhookConfigById(c.env.DB, c.get('userId'), webhookId)
  if (!current) {
    return c.json({ error: 'Not found' }, 404)
  }
  const update = mergeWebhookBody(current, await c.req.json<WebhookBody>())
  if (!update) {
    return c.json({ error: 'Invalid body' }, 400)
  }
  await updateWebhookConfig(c.env.DB, c.get('userId'), webhookId, update)
  return c.json({ webhook: await getWebhookConfigById(c.env.DB, c.get('userId'), webhookId) })
})

webhookRoutes.delete('/:id', async (c) => {
  const webhookId = parseWebhookId(c.req.param('id'))
  if (!webhookId) {
    return c.json({ error: 'Invalid webhook id' }, 400)
  }
  await deleteWebhookConfig(c.env.DB, c.get('userId'), webhookId)
  return c.json({ status: 'ok' })
})

webhookRoutes.get('/:id/deliveries', async (c) => {
  const webhookId = parseWebhookId(c.req.param('id'))
  if (!webhookId) {
    return c.json({ error: 'Invalid webhook id' }, 400)
  }
  const webhook = await getWebhookConfigById(c.env.DB, c.get('userId'), webhookId)
  if (!webhook) {
    return c.json({ error: 'Not found' }, 404)
  }
  const limit = Math.min(Number(c.req.query('limit')) || 10, 50)
  return c.json({ deliveries: await getWebhookDeliveries(c.env.DB, webhookId, limit) })
})

webhookRoutes.post('/:id/test', async (c) => {
  const webhookId = parseWebhookId(c.req.param('id'))
  if (!webhookId) {
    return c.json({ error: 'Invalid webhook id' }, 400)
  }
  const webhook = await getWebhookConfigById(c.env.DB, c.get('userId'), webhookId)
  if (!webhook) {
    return c.json({ error: 'Not found' }, 404)
  }
  const body = await c.req.json<{ event?: string; data?: Record<string, unknown> }>()
  const event = body.event ?? 'test'
  const payload = {
    event,
    timestamp: new Date().toISOString(),
    data: body.data ?? { message: 'Hello from AgentShow' },
  }
  const result = await sendWebhook(webhook.url, payload, webhook.secret)
  await insertWebhookDelivery(c.env.DB, {
    webhook_id: webhook.id,
    event_type: event,
    payload: JSON.stringify(payload),
    status_code: result.status_code || null,
    response_body: result.response_body,
    success: result.success ? 1 : 0,
  })
  return c.json({ delivery: result })
})
