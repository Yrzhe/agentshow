import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ClaudeSessionMeta } from '@agentshow/shared'
import { scanSessions } from '../src/discovery/session-scanner.js'
import { cwdToSlug } from '../src/discovery/slug.js'

const tempDirs: string[] = []

function createClaudeDir(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `agentshow-${name}-`))
  tempDirs.push(dir)
  return dir
}

function writeSession(dir: string, fileName: string, content: string): void {
  const sessionsDir = join(dir, 'sessions')
  mkdirSync(sessionsDir, { recursive: true })
  writeFileSync(join(sessionsDir, fileName), content)
}

function createMeta(overrides: Partial<ClaudeSessionMeta> = {}): ClaudeSessionMeta {
  return {
    pid: 123,
    sessionId: 'ses_123',
    cwd: '/tmp/project',
    startedAt: 1,
    kind: 'interactive',
    entrypoint: 'cli',
    ...overrides,
  }
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})

describe('session scanner', () => {
  it('reads valid session files and skips tmp files', () => {
    const claudeDir = createClaudeDir('scanner')
    writeSession(claudeDir, '1.json', JSON.stringify(createMeta()))
    writeSession(claudeDir, '2.tmp.json', JSON.stringify(createMeta({ pid: 456 })))

    expect(scanSessions(claudeDir)).toEqual([createMeta()])
  })

  it('returns empty list for missing or empty sessions directory', () => {
    const missingDir = createClaudeDir('missing')
    const emptyDir = createClaudeDir('empty')
    mkdirSync(join(emptyDir, 'sessions'), { recursive: true })

    expect(scanSessions(missingDir)).toEqual([])
    expect(scanSessions(emptyDir)).toEqual([])
  })

  it('ignores malformed json files', () => {
    const claudeDir = createClaudeDir('malformed')
    writeSession(claudeDir, '1.json', '{bad json')
    writeSession(claudeDir, '2.json', JSON.stringify(createMeta({ pid: 789 })))

    expect(scanSessions(claudeDir)).toEqual([createMeta({ pid: 789 })])
  })
})

describe('cwdToSlug', () => {
  it('matches verified claude project slugs for real paths', () => {
    expect(cwdToSlug('/Users/renzheyu/Downloads/Manual Library/项目/pagefly')).toBe(
      '-Users-renzheyu-Downloads-Manual-Library----pagefly',
    )
    expect(
      cwdToSlug(
        '/Users/renzheyu/Library/CloudStorage/GoogleDrive-qq1514337391@gmail.com/My Drive/自媒体运营',
      ),
    ).toBe(
      '-Users-renzheyu-Library-CloudStorage-GoogleDrive-qq1514337391-gmail-com-My-Drive------',
    )
  })
})
