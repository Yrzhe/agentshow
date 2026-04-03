import { closeSync, fstatSync, openSync, readSync } from 'node:fs'

import { type ConversationEvent } from '@agentshow/shared'

export class JsonlReader {
  private readonly offsets = new Map<string, number>()

  readNewEvents(filePath: string): { events: ConversationEvent[]; newOffset: number } {
    const offset = this.getOffset(filePath)
    const fd = openSync(filePath, 'r')

    try {
      const { size } = fstatSync(fd)

      if (offset >= size) {
        return { events: [], newOffset: offset }
      }

      const buffer = Buffer.alloc(size - offset)
      readSync(fd, buffer, 0, buffer.length, offset)

      const lastNewlineIndex = buffer.lastIndexOf(0x0a)

      if (lastNewlineIndex === -1) {
        return { events: [], newOffset: offset }
      }

      const completeBuffer = buffer.subarray(0, lastNewlineIndex + 1)
      const events = completeBuffer
        .toString('utf8')
        .split('\n')
        .filter((line) => line.length > 0)
        .flatMap((line) => {
          const normalizedLine = line.endsWith('\r') ? line.slice(0, -1) : line

          try {
            return [JSON.parse(normalizedLine) as ConversationEvent]
          } catch (error) {
            console.error(`Failed to parse JSONL line from ${filePath}:`, error)
            return []
          }
        })

      return {
        events,
        newOffset: offset + lastNewlineIndex + 1,
      }
    } finally {
      closeSync(fd)
    }
  }

  getOffset(filePath: string): number {
    return this.offsets.get(filePath) ?? 0
  }

  setOffset(filePath: string, offset: number): void {
    this.offsets.set(filePath, offset)
  }
}
