import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { JsonlReader } from '../src/parser/jsonl-reader.js'

function createTempFile(name: string): { dir: string; filePath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'agentshow-jsonl-reader-'))
  return { dir, filePath: join(dir, name) }
}

describe('JsonlReader', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    vi.restoreAllMocks()

    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reads a new file from offset 0', () => {
    const { dir, filePath } = createTempFile('events.jsonl')
    tempDirs.push(dir)

    writeFileSync(filePath, [
      JSON.stringify({ type: 'user', sessionId: 's1', timestamp: '2026-04-02T15:49:14.084Z' }),
      JSON.stringify({ type: 'assistant', sessionId: 's1', timestamp: '2026-04-02T15:49:20.000Z' }),
      '',
    ].join('\n'))

    const reader = new JsonlReader()
    const result = reader.readNewEvents(filePath)

    expect(result.events).toHaveLength(2)
    expect(result.events.map((event) => event.type)).toEqual(['user', 'assistant'])
    expect(result.newOffset).toBe(Buffer.byteLength([
      JSON.stringify({ type: 'user', sessionId: 's1', timestamp: '2026-04-02T15:49:14.084Z' }),
      JSON.stringify({ type: 'assistant', sessionId: 's1', timestamp: '2026-04-02T15:49:20.000Z' }),
      '',
    ].join('\n')))
  })

  it('reads only appended lines during incremental reads', () => {
    const { dir, filePath } = createTempFile('events.jsonl')
    tempDirs.push(dir)

    writeFileSync(filePath, `${JSON.stringify({ type: 'user', sessionId: 's1' })}\n`)

    const reader = new JsonlReader()
    const firstRead = reader.readNewEvents(filePath)
    reader.setOffset(filePath, firstRead.newOffset)

    appendFileSync(filePath, [
      JSON.stringify({ type: 'assistant', sessionId: 's1' }),
      JSON.stringify({ type: 'permission-mode', sessionId: 's1' }),
      '',
    ].join('\n'))

    const secondRead = reader.readNewEvents(filePath)

    expect(firstRead.events).toHaveLength(1)
    expect(secondRead.events.map((event) => event.type)).toEqual(['assistant', 'permission-mode'])
  })

  it('skips incomplete lines until they are completed', () => {
    const { dir, filePath } = createTempFile('events.jsonl')
    tempDirs.push(dir)

    writeFileSync(filePath, JSON.stringify({ type: 'user', sessionId: 's1' }))

    const reader = new JsonlReader()
    const firstRead = reader.readNewEvents(filePath)

    expect(firstRead.events).toEqual([])
    expect(firstRead.newOffset).toBe(0)

    appendFileSync(filePath, '\n')

    const secondRead = reader.readNewEvents(filePath)

    expect(secondRead.events).toHaveLength(1)
    expect(secondRead.events[0]?.type).toBe('user')
  })

  it('skips malformed json lines and logs to stderr', () => {
    const { dir, filePath } = createTempFile('events.jsonl')
    tempDirs.push(dir)

    writeFileSync(filePath, [
      '{"type":"user","sessionId":"s1"}',
      '{bad json}',
      '{"type":"assistant","sessionId":"s1"}',
      '',
    ].join('\n'))

    const reader = new JsonlReader()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = reader.readNewEvents(filePath)

    expect(result.events.map((event) => event.type)).toEqual(['user', 'assistant'])
    expect(errorSpy).toHaveBeenCalledTimes(1)
  })

  it('returns an empty array for an empty file', () => {
    const { dir, filePath } = createTempFile('events.jsonl')
    tempDirs.push(dir)

    writeFileSync(filePath, '')

    const reader = new JsonlReader()

    expect(reader.readNewEvents(filePath)).toEqual({ events: [], newOffset: 0 })
  })

  it('persists offsets with setOffset and getOffset', () => {
    const reader = new JsonlReader()
    const filePath = '/tmp/example.jsonl'

    expect(reader.getOffset(filePath)).toBe(0)

    reader.setOffset(filePath, 128)

    expect(reader.getOffset(filePath)).toBe(128)
  })
})
