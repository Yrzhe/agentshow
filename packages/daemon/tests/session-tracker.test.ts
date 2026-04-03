import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import type { ClaudeSessionMeta, ConversationEvent } from '@agentshow/shared'
import { getDaemonDb } from '../src/db/connection.js'
import {
  getAllDaemonSessions,
  getDaemonSessionsByStatus,
  getSessionEvents,
  getSessionStats,
} from '../src/db/queries.js'
import { SessionTracker } from '../src/tracker/session-tracker.js'

const tempDirs: string[] = []
const openDbs: Database.Database[] = []

function createTempDir(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `agentshow-tracker-${name}-`))
  tempDirs.push(dir)
  return dir
}

function trackDb(db: Database.Database): Database.Database {
  openDbs.push(db)
  return db
}

function createMeta(overrides: Partial<ClaudeSessionMeta> = {}): ClaudeSessionMeta {
  return {
    pid: process.pid,
    sessionId: 'session-1',
    cwd: '/tmp/project',
    startedAt: Date.now(),
    kind: 'interactive',
    entrypoint: 'cli',
    ...overrides,
  }
}

function writeSessionFile(claudeDir: string, session: ClaudeSessionMeta): string {
  const dir = join(claudeDir, 'sessions')
  mkdirSync(dir, { recursive: true })
  const filePath = join(dir, `${session.pid}.json`)
  writeFileSync(filePath, JSON.stringify(session))
  return filePath
}

function writeConversationFile(
  claudeDir: string,
  session: ClaudeSessionMeta,
  events: ConversationEvent[],
): string {
  const slug = session.cwd.replace(/[^A-Za-z0-9]/g, '-')
  const dir = join(claudeDir, 'projects', slug)
  mkdirSync(dir, { recursive: true })
  const filePath = join(dir, `${session.sessionId}.jsonl`)
  writeFileSync(filePath, events.map((event) => JSON.stringify(event)).concat('').join('\n'))
  return filePath
}

afterEach(() => {
  while (openDbs.length > 0) {
    const db = openDbs.pop()
    if (db?.open) {
      db.close()
    }
  }

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})

describe('SessionTracker', () => {
  it('discovers a new session as discovered', () => {
    const claudeDir = createTempDir('discover')
    const db = trackDb(getDaemonDb(join(createTempDir('db-discover'), 'agentshow.db')))
    const session = createMeta()
    writeSessionFile(claudeDir, session)

    const tracker = new SessionTracker(db, claudeDir)
    tracker.tick()

    expect(getAllDaemonSessions(db)).toEqual([
      expect.objectContaining({ session_id: session.sessionId, status: 'discovered' }),
    ])
  })

  it('marks a session active when its jsonl file exists', () => {
    const claudeDir = createTempDir('active')
    const db = trackDb(getDaemonDb(join(createTempDir('db-active'), 'agentshow.db')))
    const session = createMeta()
    writeSessionFile(claudeDir, session)
    writeConversationFile(claudeDir, session, [])

    const tracker = new SessionTracker(db, claudeDir)
    tracker.tick()

    expect(getDaemonSessionsByStatus(db, 'active')).toEqual([
      expect.objectContaining({ session_id: session.sessionId }),
    ])
  })

  it('writes conversation events and aggregates stats from jsonl', () => {
    const claudeDir = createTempDir('events')
    const db = trackDb(getDaemonDb(join(createTempDir('db-events'), 'agentshow.db')))
    const session = createMeta()
    writeSessionFile(claudeDir, session)
    writeConversationFile(claudeDir, session, [
      { type: 'user', sessionId: session.sessionId, timestamp: '2026-04-03T00:00:00.000Z', message: { content: 'hi' } },
      {
        type: 'assistant',
        sessionId: session.sessionId,
        timestamp: '2026-04-03T00:00:01.000Z',
        message: {
          content: [{ type: 'tool_use', name: 'Read' }, { type: 'text', text: 'done' }],
          usage: { input_tokens: 11, output_tokens: 7 },
          model: 'claude',
        },
      },
    ])

    const tracker = new SessionTracker(db, claudeDir)
    tracker.tick()

    expect(getSessionEvents(db, session.sessionId)).toHaveLength(2)
    expect(getSessionStats(db, session.sessionId)).toEqual({
      message_count: 2,
      total_input_tokens: 11,
      total_output_tokens: 7,
      tool_calls: 1,
    })
  })

  it('marks a session ended when pid is not alive', () => {
    const claudeDir = createTempDir('ended-pid')
    const db = trackDb(getDaemonDb(join(createTempDir('db-ended-pid'), 'agentshow.db')))
    const session = createMeta({ pid: 999999, sessionId: 'dead-session' })
    writeSessionFile(claudeDir, session)
    writeConversationFile(claudeDir, session, [])

    const tracker = new SessionTracker(db, claudeDir)
    for (let index = 0; index < 6; index += 1) {
      tracker.tick()
    }

    expect(getAllDaemonSessions(db)).toEqual([
      expect.objectContaining({ session_id: session.sessionId, status: 'ended' }),
    ])
  })

  it('marks a session ended when the session json file disappears', () => {
    const claudeDir = createTempDir('deleted-json')
    const db = trackDb(getDaemonDb(join(createTempDir('db-deleted-json'), 'agentshow.db')))
    const session = createMeta()
    const sessionFilePath = writeSessionFile(claudeDir, session)
    writeConversationFile(claudeDir, session, [])

    const tracker = new SessionTracker(db, claudeDir)
    tracker.tick()
    unlinkSync(sessionFilePath)
    tracker.tick()

    expect(getAllDaemonSessions(db)).toEqual([
      expect.objectContaining({ session_id: session.sessionId, status: 'ended' }),
    ])
  })

  it('reads only newly appended events across ticks', () => {
    const claudeDir = createTempDir('incremental')
    const db = trackDb(getDaemonDb(join(createTempDir('db-incremental'), 'agentshow.db')))
    const session = createMeta()
    const conversationPath = writeConversationFile(claudeDir, session, [
      { type: 'user', sessionId: session.sessionId, timestamp: '2026-04-03T00:00:00.000Z', message: { content: 'first' } },
    ])
    writeSessionFile(claudeDir, session)

    const tracker = new SessionTracker(db, claudeDir)
    tracker.tick()

    appendFileSync(
      conversationPath,
      `${JSON.stringify({
        type: 'assistant',
        sessionId: session.sessionId,
        timestamp: '2026-04-03T00:00:01.000Z',
        message: {
          content: [{ type: 'text', text: 'second' }],
          usage: { input_tokens: 5, output_tokens: 3 },
        },
      })}\n`,
    )

    tracker.tick()

    expect(getSessionEvents(db, session.sessionId).map((event) => event.content_preview)).toEqual([
      'first',
      'second',
    ])
    expect(getSessionStats(db, session.sessionId)).toEqual({
      message_count: 2,
      total_input_tokens: 5,
      total_output_tokens: 3,
      tool_calls: 0,
    })
  })
})
