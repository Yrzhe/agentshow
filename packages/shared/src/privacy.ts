import { createHash } from 'node:crypto'
import type {
  AgentShowConfig,
  DaemonSession,
  MessageRecord,
  PrivacyLevel,
  SyncEvent,
  SyncSession,
} from './types.js'

export function shouldSync(config: AgentShowConfig): boolean {
  return (
    config.privacy.level >= 1 &&
    typeof config.cloud.url === 'string' &&
    config.cloud.url.length > 0 &&
    typeof config.cloud.token === 'string' &&
    config.cloud.token.length > 0
  )
}

export function shapeSessionForSync(
  session: DaemonSession,
  level: PrivacyLevel,
): SyncSession {
  return {
    session_id: session.session_id,
    pid: session.pid,
    cwd: level >= 2 ? session.cwd : hashString(session.cwd),
    project_slug: session.project_slug,
    status: session.status,
    started_at: session.started_at,
    last_seen_at: session.last_seen_at,
    message_count: session.message_count,
    total_input_tokens: session.total_input_tokens,
    total_output_tokens: session.total_output_tokens,
    tool_calls: session.tool_calls,
    conversation_path: level >= 2 ? session.conversation_path : undefined,
  }
}

export function shapeEventForSync(
  event: MessageRecord,
  level: PrivacyLevel,
): SyncEvent | null {
  if (level < 2) {
    return null
  }

  return {
    local_id: event.id,
    session_id: event.session_id,
    type: event.type,
    role: event.role,
    tool_name: event.tool_name,
    input_tokens: event.input_tokens,
    output_tokens: event.output_tokens,
    model: event.model,
    timestamp: event.timestamp,
    content_preview: event.content_preview,
  }
}

function hashString(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}
