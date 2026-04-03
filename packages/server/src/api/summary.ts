import type Database from 'better-sqlite3'
import { Hono } from 'hono'
import { getCloudEvents, getCloudSession, updateSessionSummary } from '../db/queries.js'
import type { ServerEnv } from '../env.js'
import { flexAuth, type ServerAppType } from '../middleware/auth.js'
import type { SyncEvent } from '../types.js'

export const summaryRoutes = new Hono<ServerAppType>()
summaryRoutes.use('*', flexAuth())

summaryRoutes.post('/:id/summary', async (c) => {
  const db = c.get('db')
  const env = c.get('env')
  const userId = c.get('userId')
  const sessionId = c.req.param('id')

  const session = getCloudSession(db, userId, sessionId)
  if (!session) {
    return c.json({ error: 'Session not found' }, 404)
  }

  const events = getCloudEvents(db, userId, sessionId, { limit: 100 })
  if (events.length === 0) {
    return c.json({ error: 'No events to summarize' }, 400)
  }

  try {
    const summary = await generateSummary(events, env)
    updateSessionSummary(db, userId, sessionId, summary)
    return c.json({ summary })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Summary generation failed.'
    return c.json({ error: message }, message.includes('disabled') ? 503 : 502)
  }
})

async function generateSummary(events: SyncEvent[], env: ServerEnv): Promise<string> {
  if (env.AI_PROVIDER === 'disabled') {
    throw new Error('AI summary is disabled')
  }

  if (env.AI_PROVIDER !== 'anthropic') {
    throw new Error(`Unsupported AI provider: ${env.AI_PROVIDER}`)
  }

  if (!env.AI_API_KEY) {
    throw new Error('AI_API_KEY is not configured')
  }

  const conversation = events
    .filter((event) => event.role === 'user' || event.role === 'assistant')
    .map((event) => {
      const role = event.role === 'user' ? 'User' : 'Agent'
      const tools = event.tool_name ? ` [tools: ${event.tool_name}]` : ''
      const preview = event.content_preview || '(no content)'
      return `${role}${tools}: ${preview}`
    })
    .join('\n')
    .slice(0, 4000)

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'x-api-key': env.AI_API_KEY,
    },
    body: JSON.stringify({
      model: env.AI_MODEL || 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system:
        'Summarize this AI agent coding session in 2-3 sentences. Focus on what was accomplished, key decisions made, and files changed. Be concise. Output in the same language as the conversation.',
      messages: [{ role: 'user', content: conversation }],
    }),
  })

  if (!response.ok) {
    throw new Error(`Anthropic request failed: ${response.status}`)
  }

  const payload = await response.json() as {
    content?: Array<{ type?: string; text?: string }>
  }
  const summary = payload.content
    ?.filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text?.trim() ?? '')
    .join('\n')
    .trim()

  if (!summary) {
    throw new Error('Anthropic did not return a summary')
  }

  return summary
}
