import { Hono } from 'hono'
import type Database from 'better-sqlite3'
import {
  createWebhookConfig,
  deleteWebhookConfig,
  getWebhookConfigById,
  getWebhookConfigs,
  getWebhookDeliveries,
  insertWebhookDelivery,
  updateWebhookConfig,
} from '../db/queries.js'
import { flexAuth, type ServerAppType } from '../middleware/auth.js'
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

async function withLatestDeliveries(db: Database.Database, userId: string) {
  const hooks = getWebhookConfigs(db, userId)
  return hooks.map((hook) => ({ ...hook, latest_delivery: getWebhookDeliveries(db, hook.id, 1)[0] ?? null }))
}

export const webhookRoutes = new Hono<ServerAppType>()
webhookRoutes.use('*', flexAuth())

webhookRoutes.get('/', async (c) => {
  const webhooks = await withLatestDeliveries(c.get('db'), c.get('userId'))
  return c.json({ webhooks })
})

webhookRoutes.post('/', async (c) => {
  const parsed = parseCreateBody(await c.req.json<WebhookBody>())
  if (!parsed) {
    return c.json({ error: 'Invalid url' }, 400)
  }
  const id = createWebhookConfig(c.get('db'), c.get('userId'), parsed)
  const webhook = getWebhookConfigById(c.get('db'), c.get('userId'), id)
  return c.json({ webhook }, 201)
})

webhookRoutes.put('/:id', async (c) => {
  const webhookId = parseWebhookId(c.req.param('id'))
  if (!webhookId) {
    return c.json({ error: 'Invalid webhook id' }, 400)
  }
  const current = getWebhookConfigById(c.get('db'), c.get('userId'), webhookId)
  if (!current) {
    return c.json({ error: 'Not found' }, 404)
  }
  const update = mergeWebhookBody(current, await c.req.json<WebhookBody>())
  if (!update) {
    return c.json({ error: 'Invalid body' }, 400)
  }
  updateWebhookConfig(c.get('db'), c.get('userId'), webhookId, update)
  return c.json({ webhook: getWebhookConfigById(c.get('db'), c.get('userId'), webhookId) })
})

webhookRoutes.delete('/:id', async (c) => {
  const webhookId = parseWebhookId(c.req.param('id'))
  if (!webhookId) {
    return c.json({ error: 'Invalid webhook id' }, 400)
  }
  deleteWebhookConfig(c.get('db'), c.get('userId'), webhookId)
  return c.json({ status: 'ok' })
})

webhookRoutes.get('/:id/deliveries', async (c) => {
  const webhookId = parseWebhookId(c.req.param('id'))
  if (!webhookId) {
    return c.json({ error: 'Invalid webhook id' }, 400)
  }
  const webhook = getWebhookConfigById(c.get('db'), c.get('userId'), webhookId)
  if (!webhook) {
    return c.json({ error: 'Not found' }, 404)
  }
  const limit = Math.min(Number(c.req.query('limit')) || 10, 50)
  return c.json({ deliveries: getWebhookDeliveries(c.get('db'), webhookId, limit) })
})

webhookRoutes.post('/:id/test', async (c) => {
  const webhookId = parseWebhookId(c.req.param('id'))
  if (!webhookId) {
    return c.json({ error: 'Invalid webhook id' }, 400)
  }
  const webhook = getWebhookConfigById(c.get('db'), c.get('userId'), webhookId)
  if (!webhook) {
    return c.json({ error: 'Not found' }, 404)
  }
  const body = await c.req.json<{ event?: string; data?: Record<string, unknown> }>().catch(() => ({ event: undefined, data: undefined }))
  const event = body.event ?? 'test'
  const payload = {
    event,
    timestamp: new Date().toISOString(),
    data: body.data ?? { message: 'Hello from AgentShow' },
  }
  const result = await sendWebhook(webhook.url, payload, webhook.secret)
  insertWebhookDelivery(c.get('db'), {
    webhook_id: webhook.id,
    event_type: event,
    payload: JSON.stringify(payload),
    status_code: result.status_code || null,
    response_body: result.response_body,
    success: result.success ? 1 : 0,
  })
  return c.json({ delivery: result })
})
