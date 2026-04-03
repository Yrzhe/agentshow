import { describe, expect, it } from 'vitest'

import { extractEvents } from '../src/parser/event-extractor.js'

describe('extractEvents', () => {
  it('extracts assistant token usage', () => {
    const [event] = extractEvents([{
      type: 'assistant',
      sessionId: 's1',
      timestamp: '2026-04-02T15:49:20.000Z',
      message: {
        content: [{ type: 'text', text: 'Hi!' }],
        usage: { input_tokens: 1500, output_tokens: 200 },
        model: 'claude-opus-4-6',
      },
    }])

    expect(event).toMatchObject({
      session_id: 's1',
      type: 'assistant',
      role: 'assistant',
      content_preview: 'Hi!',
      input_tokens: 1500,
      output_tokens: 200,
      model: 'claude-opus-4-6',
    })
  })

  it('extracts tool names from assistant content', () => {
    const [event] = extractEvents([{
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', name: 'Read' },
          { type: 'text', text: 'Done.' },
        ],
      },
    }])

    expect(event?.tool_name).toBe('Read')
  })

  it('joins multiple tool names with commas', () => {
    const [event] = extractEvents([{
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', name: 'Read' },
          { type: 'tool_use', name: 'Write' },
          { type: 'text', text: 'Done.' },
        ],
      },
    }])

    expect(event?.tool_name).toBe('Read,Write')
  })

  it('supports assistant string content', () => {
    const [event] = extractEvents([{
      type: 'assistant',
      message: {
        content: 'plain text response',
      },
    }])

    expect(event?.content_preview).toBe('plain text response')
  })

  it('extracts user events', () => {
    const [event] = extractEvents([{
      type: 'user',
      sessionId: 's1',
      message: {
        content: 'hello',
      },
    }])

    expect(event).toMatchObject({
      session_id: 's1',
      type: 'user',
      role: 'user',
      content_preview: 'hello',
      tool_name: null,
      input_tokens: 0,
      output_tokens: 0,
      model: null,
    })
  })

  it('returns null role and payload fields for non user assistant events', () => {
    const [event] = extractEvents([{
      type: 'permission-mode',
      sessionId: 's1',
      timestamp: '2026-04-02T15:49:20.000Z',
    }])

    expect(event).toEqual({
      session_id: 's1',
      type: 'permission-mode',
      role: null,
      content_preview: null,
      tool_name: null,
      input_tokens: 0,
      output_tokens: 0,
      model: null,
      timestamp: '2026-04-02T15:49:20.000Z',
    })
  })

  it('uses defaults for missing fields', () => {
    const [event] = extractEvents([{
      type: 'assistant',
      message: {},
    }])

    expect(event).toEqual({
      session_id: '',
      type: 'assistant',
      role: 'assistant',
      content_preview: null,
      tool_name: null,
      input_tokens: 0,
      output_tokens: 0,
      model: null,
      timestamp: '',
    })
  })

  it('truncates content_preview to 200 characters', () => {
    const content = 'a'.repeat(250)
    const [event] = extractEvents([{
      type: 'assistant',
      message: {
        content,
      },
    }])

    expect(event?.content_preview).toBe('a'.repeat(200))
  })

  it('returns an empty array for empty input', () => {
    expect(extractEvents([])).toEqual([])
  })

  it('skips events without type', () => {
    const events = extractEvents([
      { type: 'user', message: { content: 'hello' } },
      { type: '' } as never,
    ])

    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('user')
  })
})
