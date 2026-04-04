import {
  getActiveWebhooksForEvent,
  insertWebhookDelivery,
} from '../db/queries.js'

interface WebhookPayload {
  event: string
  timestamp: string
  data: Record<string, unknown>
}

type WebhookResult = {
  success: boolean
  status_code: number
  response_body: string
}

function truncateBody(value: string): string {
  return value.length > 4000 ? value.slice(0, 4000) : value
}

export async function sendWebhook(
  url: string,
  payload: WebhookPayload,
  secret?: string | null,
): Promise<WebhookResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (secret) {
      headers['X-Webhook-Secret'] = secret
    }
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    const body = truncateBody(await response.text())
    return { success: response.ok, status_code: response.status, response_body: body }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Webhook request failed'
    return { success: false, status_code: 0, response_body: truncateBody(message) }
  } finally {
    clearTimeout(timeout)
  }
}

export async function triggerWebhooks(
  db: D1Database,
  userId: string,
  eventType: string,
  data: Record<string, unknown>,
): Promise<void> {
  const hooks = await getActiveWebhooksForEvent(db, userId, eventType)
  const payload = { event: eventType, timestamp: new Date().toISOString(), data }
  await Promise.all(hooks.map(async (hook) => {
    const result = await sendWebhook(hook.url, payload, hook.secret)
    await insertWebhookDelivery(db, {
      webhook_id: hook.id,
      event_type: eventType,
      payload: JSON.stringify(payload),
      status_code: result.status_code || null,
      response_body: result.response_body,
      success: result.success ? 1 : 0,
    })
  }))
}
