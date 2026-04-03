import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import type { DaemonSession, MessageRecord } from '@agentshow/shared'
import { getDaemonDb } from '../src/db/connection.js'
import {
  getEventsAfterLocalId,
  getSessionsModifiedSince,
  getSyncState,
  insertConversationEvents,
  setSyncState,
  upsertDaemonSession,
} from '../src/db/queries.js'

const tempDirs: string[] = []
const openDbs: Database.Database[] = []

function createDb(): Database.Database {
  const dir = mkdtempSync(join(tmpdir(), 'agentshow-sync-queries-'))
  tempDirs.push(dir)
  const db = getDaemonDb(join(dir, 'agentshow.db'))
  openDbs.push(db)
  return db
}

function createSession(overrides: Partial<DaemonSession> = {}): DaemonSession {
  return {
    session_id: 'ses_1',
    pid: 1,
    cwd: '/tmp/project',
    project_slug: '-tmp-project',
    status: 'active',
    started_at: '2026-04-03T00:00:00.000Z',
    last_seen_at: '2026-04-03T00:00:00.000Z',
    conversation_path: null,
    message_count: 0,
    total_input_tokens: 0,
    total_output_tokens: 0,
    tool_calls: 0,
    ...overrides,
  }
}

function createEvent(overrides: Partial<Omit<MessageRecord, 'id'>> = {}): Omit<MessageRecord, 'id'> {
  return {
    session_id: 'ses_1',
    type: 'assistant',
    role: 'assistant',
    content_preview: 'hello',
    tool_name: null,
    input_tokens: 1,
    output_tokens: 2,
    model: 'claude',
    timestamp: '2026-04-03T00:00:00.000Z',
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

describe('sync queries', () => {
  it('gets and sets sync state values', () => {
    const db = createDb()

    expect(getSyncState(db, 'last_synced_event_id')).toBeNull()
    setSyncState(db, 'last_synced_event_id', '12')

    expect(getSyncState(db, 'last_synced_event_id')).toBe('12')
  })

  it('returns sessions modified since a timestamp', () => {
    const db = createDb()
    upsertDaemonSession(db, createSession({ session_id: 'ses_1', last_seen_at: '2026-04-03T00:00:00.000Z' }))
    upsertDaemonSession(db, createSession({ session_id: 'ses_2', last_seen_at: '2026-04-03T01:00:00.000Z' }))

    expect(getSessionsModifiedSince(db, '2026-04-03T00:30:00.000Z').map((session) => session.session_id)).toEqual([
      'ses_2',
    ])
  })

  it('returns events after a local id with limit', () => {
    const db = createDb()
    upsertDaemonSession(db, createSession())
    insertConversationEvents(db, [
      createEvent({ timestamp: '2026-04-03T00:00:00.000Z', content_preview: 'one' }),
      createEvent({ timestamp: '2026-04-03T00:00:01.000Z', content_preview: 'two' }),
      createEvent({ timestamp: '2026-04-03T00:00:02.000Z', content_preview: 'three' }),
    ])

    expect(getEventsAfterLocalId(db, 1, 2).map((event) => event.content_preview)).toEqual([
      'two',
      'three',
    ])
  })
})
