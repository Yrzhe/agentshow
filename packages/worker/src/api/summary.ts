import { Hono } from 'hono'
import type { AppType } from '../index.js'
import { flexAuth } from '../middleware/auth.js'
import { getCloudEvents, getCloudSession, updateSessionSummary } from '../db/queries.js'
import type { SyncEvent } from '../types.js'

export const summaryRoutes = new Hono<AppType>()
summaryRoutes.use('*', flexAuth())

summaryRoutes.post('/:id/summary', async (c) => {
  const userId = c.get('userId')
  const sessionId = c.req.param('id')

  const session = await getCloudSession(c.env.DB, userId, sessionId)
  if (!session) {
    return c.json({ error: 'Session not found' }, 404)
  }

  const events = await getCloudEvents(c.env.DB, userId, sessionId, { limit: 100 })
  if (events.length === 0) {
    return c.json({ error: 'No events to summarize' }, 400)
  }

  try {
    const summary = await generateSummary(events, c.env)
    await updateSessionSummary(c.env.DB, userId, sessionId, summary)
    return c.json({ summary })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Summary generation failed.'
    return c.json({ error: message }, message.includes('AI binding') ? 503 : 502)
  }
})

async function generateSummary(
  events: SyncEvent[],
  env: AppType['Bindings'],
): Promise<string> {
  if (!env.AI) {
    throw new Error('AI binding is not configured.')
  }

  const conversation = events
    .filter((e) => e.role === 'user' || e.role === 'assistant')
    .map((e) => {
      const role = e.role === 'user' ? 'User' : 'Agent'
      const tools = e.tool_name ? ` [tools: ${e.tool_name}]` : ''
      const preview = e.content_preview || '(no content)'
      return `${role}${tools}: ${preview}`
    })
    .join('\n')
    .slice(0, 4000)

  const response = await env.AI.run(
    '@cf/meta/llama-3.1-8b-instruct' as Parameters<typeof env.AI.run>[0],
    {
      messages: [
        {
          role: 'system',
          content:
            'Summarize this AI agent coding session in 2-3 sentences. Focus on what was accomplished, key decisions made, and files changed. Be concise. Output in the same language as the conversation.',
        },
        { role: 'user', content: conversation },
      ],
    } as Parameters<typeof env.AI.run>[1],
  )

  const result = response as { response?: string }
  if (!result.response) {
    throw new Error('Workers AI did not return a summary.')
  }

  return result.response
}
