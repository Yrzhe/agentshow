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

  it('concatenates assistant text blocks', () => {
    const [event] = extractEvents([{
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: '让我检查一下' },
          { type: 'tool_use', name: 'Bash' },
          { type: 'text', text: '然后读取文件' },
        ],
      },
    }])

    expect(event?.content_preview).toBe('让我检查一下\n\n然后读取文件')
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

  it('extracts user content from multiple text blocks', () => {
    const [event] = extractEvents([{
      type: 'user',
      message: {
        content: [
          { type: 'text', text: 'hello' },
          { type: 'image', source: { type: 'base64' } },
          { type: 'text', text: 'world' },
        ],
      },
    }])

    expect(event?.content_preview).toBe('hello\n\nworld')
  })

  it('returns no content placeholder for empty user payloads', () => {
    const [event] = extractEvents([{
      type: 'user',
      message: {
        content: null,
      },
    }])

    expect(event?.content_preview).toBe('(no content)')
  })

  it('returns attachment placeholder for image-only user payloads', () => {
    const [event] = extractEvents([{
      type: 'user',
      message: {
        content: [
          { type: 'image', source: { type: 'base64' } },
        ],
      },
    }])

    expect(event?.content_preview).toBe('(attachment)')
  })

  it('supports user object content with text field outside message arrays', () => {
    const [event] = extractEvents([{
      type: 'user',
      message: {
        content: {
          text: 'object text payload',
        },
      },
    }])

    expect(event?.content_preview).toBe('object text payload')
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

  it('preserves long content_preview up to 8000 characters', () => {
    const content = 'a'.repeat(250)
    const [event] = extractEvents([{
      type: 'assistant',
      message: {
        content,
      },
    }])

    expect(event?.content_preview).toBe('a'.repeat(250))
  })

  it('returns an empty array for empty input', () => {
    expect(extractEvents([])).toEqual([])
  })

  it('skips non-relevant event types and events without type', () => {
    const events = extractEvents([
      { type: 'user', message: { content: 'hello' } },
      { type: 'system', message: { content: 'reminder' } },
      { type: 'permission-mode' } as never,
      { type: '' } as never,
    ])

    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('user')
  })
})
