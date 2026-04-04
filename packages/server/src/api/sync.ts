import { Hono } from 'hono'
import type { SyncPayload } from '@agentshow/shared'
import { getWatermark, insertAuditLog, insertCloudEvents, updateWatermark, upsertCloudNote, upsertCloudSession } from '../db/queries.js'
import { triggerWebhooks } from '../lib/webhook-sender.js'
import { executeWorkflows } from '../lib/workflow-engine.js'
import { bearerAuth, type ServerAppType } from '../middleware/auth.js'

export const syncRoutes = new Hono<ServerAppType>()

syncRoutes.use('*', bearerAuth())

syncRoutes.post('/', async (c) => {
  const payload = await c.req.json<SyncPayload>()
  const userId = c.get('userId')
  const db = c.get('db')
  const watermark = getWatermark(db, userId, payload.device_id)

  for (const session of payload.sessions) {
    upsertCloudSession(db, userId, session, payload.device_id)
  }

  const events = payload.events.filter(
    (event) => event.local_id > watermark.last_event_local_id,
  )
  const projectSlugMap = new Map(
    payload.sessions.map((s) => [s.session_id, s.project_slug]),
  )

  insertCloudEvents(db, userId, events)
  try {
    for (const event of events) {
      const audit = toAuditLog(event, projectSlugMap.get(event.session_id) ?? null)
      if (audit) {
        insertAuditLog(db, userId, audit)
      }
    }
  } catch {
    // Keep sync responses fast even if audit extraction fails.
  }

  const notes = payload.notes ?? []
  for (const note of notes) {
    const projectSlug = note.session_id
      ? projectSlugMap.get(note.session_id) ?? null
      : null
    upsertCloudNote(db, userId, payload.device_id, note, projectSlug)
  }

  updateWatermark(
    db,
    userId,
    payload.device_id,
    payload.sessions[payload.sessions.length - 1]?.last_seen_at ?? watermark.last_session_seen_at,
    events[events.length - 1]?.local_id ?? watermark.last_event_local_id,
  )

  payload.sessions
    .filter((session) => session.status === 'ended')
    .forEach((session) => {
      void triggerWebhooks(db, userId, 'session.ended', {
        session_id: session.session_id,
        project_slug: session.project_slug,
        cwd: session.cwd,
        started_at: session.started_at,
        last_seen_at: session.last_seen_at,
        message_count: session.message_count,
        total_input_tokens: session.total_input_tokens,
        total_output_tokens: session.total_output_tokens,
        tool_calls: session.tool_calls,
        task: session.task ?? null,
      }).catch(() => undefined)
      void executeWorkflows(db, userId, 'session.ended', {
        session_id: session.session_id,
        project_slug: session.project_slug,
        status: session.status,
        cwd: session.cwd,
      }).catch(() => undefined)
    })

  return c.json({
    status: 'ok' as const,
    accepted_sessions: payload.sessions.length,
    accepted_events: events.length,
    accepted_notes: notes.length,
    server_time: new Date().toISOString(),
  })
})

function toAuditLog(event: SyncPayload['events'][number], projectSlug: string | null) {
  const toolName = String(event.tool_name ?? '').toLowerCase()
  const preview = String(event.content_preview ?? '')
  const filePath = extractFilePath(preview)
  if (/(write|edit)/.test(toolName)) {
    return { session_id: event.session_id, project_slug: projectSlug, action_type: inferFileAction(preview), action_detail: preview, file_path: filePath, metadata: JSON.stringify({ tool_name: event.tool_name }) }
  }
  if (/(bash|shell|command)/.test(toolName)) {
    return { session_id: event.session_id, project_slug: projectSlug, action_type: inferCommandAction(preview), action_detail: preview, file_path: filePath, metadata: JSON.stringify({ tool_name: event.tool_name }) }
  }
  if (toolName) {
    return { session_id: event.session_id, project_slug: projectSlug, action_type: 'tool_call' as const, action_detail: preview, file_path: filePath, metadata: JSON.stringify({ tool_name: event.tool_name }) }
  }
  return null
}

function inferFileAction(preview: string) {
  if (/delete|remove/i.test(preview)) return 'file_delete' as const
  if (/create|add file/i.test(preview)) return 'file_create' as const
  return 'file_edit' as const
}

function inferCommandAction(preview: string) {
  if (/pr create/i.test(preview)) return 'pr_create' as const
  if (/pr merge/i.test(preview)) return 'pr_merge' as const
  if (/git push/i.test(preview)) return 'git_push' as const
  return 'command_exec' as const
}

function extractFilePath(preview: string): string | null {
  const match = preview.match(/([A-Za-z0-9_./-]+\.[A-Za-z0-9]+|\/[A-Za-z0-9_./-]+)/)
  return match ? match[1] : null
}
