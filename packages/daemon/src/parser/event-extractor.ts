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

const RELEVANT_TYPES = new Set(['user', 'assistant'])

export function extractEvents(events: ConversationEvent[]): ExtractedEvent[] {
  return events.flatMap((event) => {
    if (!event.type || !RELEVANT_TYPES.has(event.type)) {
      return []
    }

    if (event.type === 'assistant') {
      return [extractAssistantEvent(event)]
    }

    if (event.type === 'user') {
      if (isToolResultMessage(event)) {
        return []
      }
      return [extractUserEvent(event)]
    }

    return [createBaseEvent(event)]
  })
}

function extractAssistantEvent(event: ConversationEvent): ExtractedEvent {
  const usage = getUsage(event.message?.usage)
  const content = getEventContent(event)

  return {
    ...createBaseEvent(event),
    role: 'assistant',
    content_preview: getAssistantPreview(content),
    tool_name: getToolNames(content),
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    model: event.message?.model ?? null,
  }
}

function extractUserEvent(event: ConversationEvent): ExtractedEvent {
  return {
    ...createBaseEvent(event),
    role: 'user',
    content_preview: getUserPreview(getEventContent(event)),
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

function getEventContent(event: ConversationEvent): unknown {
  if (event.message?.content !== undefined) {
    return event.message.content
  }

  const eventRecord = event as Record<string, unknown>
  return eventRecord.content
}

function getAssistantPreview(content: unknown): string | null {
  const text = getCombinedTextContent(content)
  return text ? text.slice(0, 8000) : null
}

function getUserPreview(content: unknown): string {
  const text = getCombinedTextContent(content)
  if (text) {
    return text.slice(0, 8000)
  }

  if (Array.isArray(content) && content.some((item) => isAttachmentBlock(item))) {
    return '(attachment)'
  }

  if (content === null || content === undefined) {
    return '(no content)'
  }

  if (isRecord(content) && typeof content.type === 'string' && content.type === 'image') {
    return '(image)'
  }

  if (isRecord(content) && typeof content.text !== 'string') {
    return '(attachment)'
  }

  return '(no content)'
}

function getCombinedTextContent(content: unknown): string | null {
  if (typeof content === 'string') {
    return content
  }

  if (isRecord(content) && typeof content.text === 'string') {
    return content.text
  }

  if (!Array.isArray(content)) {
    return null
  }

  const texts = content.flatMap((item) =>
    isRecord(item) && item.type === 'text' && typeof item.text === 'string' ? [item.text] : [],
  )

  return texts.length > 0 ? texts.join(' ') : null
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

function isAttachmentBlock(value: unknown): boolean {
  return isRecord(value) && typeof value.type === 'string' && value.type !== 'text'
}

function isToolResultMessage(event: ConversationEvent): boolean {
  const content = getEventContent(event)
  if (!Array.isArray(content)) {
    return false
  }
  return content.length > 0 && content.every(
    (item) => isRecord(item) && item.type === 'tool_result',
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
