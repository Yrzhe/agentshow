import { type ConversationEvent, type TokenUsage } from '@agentshow/shared'

export interface ExtractedEvent {
  session_id: string
  type: string
  role: string | null
  content_preview: string | null
  tool_name: string | null
  input_tokens: number
  output_tokens: number
  model: string | null
  timestamp: string
}

const RELEVANT_TYPES = new Set(['user', 'assistant', 'system'])

export function extractEvents(events: ConversationEvent[]): ExtractedEvent[] {
  return events.flatMap((event) => {
    if (!event.type || !RELEVANT_TYPES.has(event.type)) {
      return []
    }

    if (event.type === 'assistant') {
      return [extractAssistantEvent(event)]
    }

    if (event.type === 'user') {
      return [extractUserEvent(event)]
    }

    return [createBaseEvent(event)]
  })
}

function extractAssistantEvent(event: ConversationEvent): ExtractedEvent {
  const usage = getUsage(event.message?.usage)

  return {
    ...createBaseEvent(event),
    role: 'assistant',
    content_preview: getContentPreview(event.message?.content),
    tool_name: getToolNames(event.message?.content),
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    model: event.message?.model ?? null,
  }
}

function extractUserEvent(event: ConversationEvent): ExtractedEvent {
  return {
    ...createBaseEvent(event),
    role: 'user',
    content_preview: getContentPreview(event.message?.content),
  }
}

function createBaseEvent(event: ConversationEvent): ExtractedEvent {
  return {
    session_id: event.sessionId ?? '',
    type: event.type,
    role: null,
    content_preview: null,
    tool_name: null,
    input_tokens: 0,
    output_tokens: 0,
    model: null,
    timestamp: event.timestamp ?? '',
  }
}

function getUsage(usage: TokenUsage | undefined): TokenUsage {
  return {
    input_tokens: usage?.input_tokens ?? 0,
    output_tokens: usage?.output_tokens ?? 0,
  }
}

function getContentPreview(content: unknown): string | null {
  const text = getFirstTextContent(content)
  return text ? text.slice(0, 200) : null
}

function getFirstTextContent(content: unknown): string | null {
  if (typeof content === 'string') {
    return content
  }

  if (!Array.isArray(content)) {
    return null
  }

  for (const item of content) {
    if (isRecord(item) && item.type === 'text' && typeof item.text === 'string') {
      return item.text
    }
  }

  return null
}

function getToolNames(content: unknown): string | null {
  if (!Array.isArray(content)) {
    return null
  }

  const names = content.flatMap((item) => {
    if (isRecord(item) && item.type === 'tool_use' && typeof item.name === 'string') {
      return [item.name]
    }

    return []
  })

  return names.length > 0 ? names.join(',') : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
