import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import type { DaemonSession, MessageRecord } from '@agentshow/shared'
import { getDaemonDb } from '../src/db/connection.js'
import {
  getAllDaemonSessions,
  getDaemonSessionsByStatus,
  getFileOffset,
  getSessionEvents,
  getSessionStats,
  insertConversationEvents,
  setFileOffset,
  updateSessionStats,
  updateSessionStatus,
  upsertDaemonSession,
} from '../src/db/queries.js'
import { initDaemonSchema } from '../src/db/schema.js'

const tempDirs: string[] = []
const openDbs: Database.Database[] = []

function createTempDbPath(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `agentshow-daemon-${name}-`))
  tempDirs.push(dir)
  return join(dir, 'agentshow.db')
}

function trackDb(db: Database.Database): Database.Database {
  openDbs.push(db)
  return db
}

function createSession(overrides: Partial<DaemonSession> = {}): DaemonSession {
  return {
    session_id: 'ses_1',
    pid: 111,
    cwd: '/tmp/project',
    project_slug: '-tmp-project',
    status: 'discovered',
    started_at: '2026-04-03 10:00:00',
    last_seen_at: '2026-04-03 10:00:00',
    conversation_path: '/tmp/project/conv.jsonl',
    message_count: 0,
    total_input_tokens: 0,
    total_output_tokens: 0,
    tool_calls: 0,
    ...overrides,
  }
}

function createEvent(
  overrides: Partial<Omit<MessageRecord, 'id'>> = {},
): Omit<MessageRecord, 'id'> {
  return {
    session_id: 'ses_1',
    type: 'message',
    role: 'assistant',
    content_preview: 'hello',
    tool_name: null,
    input_tokens: 10,
    output_tokens: 20,
    model: 'claude',
    timestamp: '2026-04-03T10:00:00.000Z',
    ...overrides,
  }
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

describe('daemon database layer', () => {
  it('creates daemon tables and indexes', () => {
    const db = trackDb(new Database(createTempDbPath('schema')))
    initDaemonSchema(db)

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{ name: string }>

    expect(tables.map((row) => row.name)).toEqual(expect.arrayContaining([
      'daemon_sessions',
      'conversation_events',
      'file_offsets',
    ]))
    expect(indexes.map((row) => row.name)).toEqual(expect.arrayContaining([
      'idx_daemon_sessions_status',
      'idx_daemon_sessions_project_slug',
      'idx_conversation_events_session_timestamp',
      'idx_conversation_events_type',
    ]))
  })

  it('supports session upsert, status updates, stats, and reads', () => {
    const db = trackDb(getDaemonDb(createTempDbPath('queries')))
    upsertDaemonSession(db, createSession())
    updateSessionStatus(db, 'ses_1', 'active')
    updateSessionStats(db, 'ses_1', {
      message_count: 3,
      total_input_tokens: 30,
      total_output_tokens: 60,
      tool_calls: 2,
    })

    expect(getDaemonSessionsByStatus(db, 'active')).toEqual([
      expect.objectContaining({ session_id: 'ses_1', status: 'active' }),
    ])
    expect(getAllDaemonSessions(db)).toHaveLength(1)
    expect(getSessionStats(db, 'ses_1')).toEqual({
      message_count: 3,
      total_input_tokens: 30,
      total_output_tokens: 60,
      tool_calls: 2,
    })
  })

  it('inserts and fetches conversation events with ordering and limits', () => {
    const db = trackDb(getDaemonDb(createTempDbPath('events')))
    upsertDaemonSession(db, createSession())
    insertConversationEvents(db, [
      createEvent({ timestamp: '2026-04-03T10:00:00.000Z', content_preview: 'first' }),
      createEvent({
        timestamp: '2026-04-03T10:01:00.000Z',
        type: 'tool_use',
        content_preview: null,
        tool_name: 'Read',
      }),
    ])

    expect(getSessionEvents(db, 'ses_1').map((event) => event.content_preview ?? event.tool_name)).toEqual([
      'first',
      'Read',
    ])
    expect(getSessionEvents(db, 'ses_1', { limit: 1 })).toHaveLength(1)
  })

  it('persists file offsets and defaults missing entries to zero', () => {
    const dbPath = createTempDbPath('offsets')
    const db = trackDb(getDaemonDb(dbPath))

    expect(getFileOffset(db, '/tmp/a.jsonl')).toBe(0)
    setFileOffset(db, '/tmp/a.jsonl', 42)
    expect(getFileOffset(db, '/tmp/a.jsonl')).toBe(42)

    db.close()
    const reopened = trackDb(new Database(dbPath))
    initDaemonSchema(reopened)
    expect(getFileOffset(reopened, '/tmp/a.jsonl')).toBe(42)
  })

  it('supports concurrent access with wal mode enabled', () => {
    const dbPath = createTempDbPath('wal')
    const writer = trackDb(getDaemonDb(dbPath))
    const reader = trackDb(new Database(dbPath))
    initDaemonSchema(reader)
    upsertDaemonSession(writer, createSession())

    expect(writer.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(getAllDaemonSessions(reader)).toEqual([
      expect.objectContaining({ session_id: 'ses_1' }),
    ])
  })
})
