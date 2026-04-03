import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentShowConfig, DaemonSession, MessageRecord, SyncPayload } from '@agentshow/shared'
import { writeConfig } from '@agentshow/shared'
import { getDaemonDb } from '../src/db/connection.js'
import {
  getSyncState,
  insertConversationEvents,
  upsertDaemonSession,
} from '../src/db/queries.js'
import { CloudSync } from '../src/sync/cloud-sync.js'

const tempDirs: string[] = []
const openDbs: Database.Database[] = []

function createTempDir(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `agentshow-cloud-sync-${name}-`))
  tempDirs.push(dir)
  return dir
}

function createDb(name: string): Database.Database {
  const db = getDaemonDb(join(createTempDir(name), 'agentshow.db'))
  openDbs.push(db)
  return db
}

function createConfig(overrides: Partial<AgentShowConfig> = {}): AgentShowConfig {
  return {
    device_id: 'dev_test',
    cloud: {
      url: 'https://example.com',
      token: 'as_test',
    },
    privacy: {
      level: 2,
    },
    ...overrides,
  }
}

function createSession(overrides: Partial<DaemonSession> = {}): DaemonSession {
  return {
    session_id: 'ses_1',
    pid: 1,
    cwd: '/tmp/project',
    project_slug: '-tmp-project',
    status: 'active',
    started_at: '2026-04-03T00:00:00.000Z',
    last_seen_at: '2026-04-03T01:00:00.000Z',
    conversation_path: '/tmp/project/conv.jsonl',
    message_count: 1,
    total_input_tokens: 2,
    total_output_tokens: 3,
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
    input_tokens: 2,
    output_tokens: 3,
    model: 'claude',
    timestamp: '2026-04-03T01:00:00.000Z',
    ...overrides,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()

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

describe('CloudSync', () => {
  it('does not sync when config is missing', async () => {
    const db = createDb('missing-config')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await new CloudSync(db, createTempDir('config-missing')).tick()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not sync when privacy level is 0', async () => {
    const db = createDb('privacy-0')
    const configDir = createTempDir('config-privacy-0')
    writeConfig(createConfig({ privacy: { level: 0 } }), configDir)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await new CloudSync(db, configDir).tick()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('syncs only sessions for privacy level 1', async () => {
    const db = createDb('privacy-1')
    const configDir = createTempDir('config-privacy-1')
    writeConfig(createConfig({ privacy: { level: 1 } }), configDir)
    upsertDaemonSession(db, createSession())
    insertConversationEvents(db, [createEvent()])
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchMock)

    await new CloudSync(db, configDir).tick()

    const payload = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as SyncPayload
    expect(payload.sessions).toHaveLength(1)
    expect(payload.events).toEqual([])
    expect(payload.sessions[0]?.cwd).not.toBe('/tmp/project')
  })

  it('syncs sessions and events for privacy level 2', async () => {
    const db = createDb('privacy-2')
    const configDir = createTempDir('config-privacy-2')
    writeConfig(createConfig({ privacy: { level: 2 } }), configDir)
    upsertDaemonSession(db, createSession())
    insertConversationEvents(db, [createEvent()])
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchMock)

    await new CloudSync(db, configDir).tick()

    const payload = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as SyncPayload
    expect(payload.sessions[0]?.cwd).toBe('/tmp/project')
    expect(payload.events).toHaveLength(1)
    expect(payload.events[0]?.local_id).toBeTypeOf('number')
  })

  it('updates sync state on successful sync', async () => {
    const db = createDb('success')
    const configDir = createTempDir('config-success')
    writeConfig(createConfig(), configDir)
    upsertDaemonSession(db, createSession({ last_seen_at: '2026-04-03T02:00:00.000Z' }))
    insertConversationEvents(db, [createEvent()])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }))

    await new CloudSync(db, configDir).tick()

    expect(getSyncState(db, 'last_synced_session_at')).toBe('2026-04-03T02:00:00.000Z')
    expect(getSyncState(db, 'last_synced_event_id')).toBe('1')
    expect(getSyncState(db, 'last_sync_error')).toBe('')
    expect(getSyncState(db, 'backoff_until')).toBe('')
    expect(getSyncState(db, 'backoff_ms')).toBe('0')
  })

  it('increases backoff when sync fails', async () => {
    const db = createDb('backoff')
    const configDir = createTempDir('config-backoff')
    writeConfig(createConfig(), configDir)
    upsertDaemonSession(db, createSession())
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 })
    vi.stubGlobal('fetch', fetchMock)
    const cloudSync = new CloudSync(db, configDir)

    await cloudSync.tick()
    const firstBackoffUntil = getSyncState(db, 'backoff_until')
    const firstBackoffMs = getSyncState(db, 'backoff_ms')
    expect(getSyncState(db, 'last_sync_error')).toContain('500')
    expect(firstBackoffMs).toBe('30000')

    if (!firstBackoffUntil) {
      throw new Error('expected first backoff_until to be set')
    }

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    db.prepare("UPDATE sync_state SET value = ? WHERE key = 'backoff_until'").run(
      new Date(Date.now() - 1000).toISOString(),
    )

    await cloudSync.tick()
    const secondBackoffUntil = getSyncState(db, 'backoff_until')
    const secondBackoffMs = getSyncState(db, 'backoff_ms')

    expect(secondBackoffUntil).not.toBeNull()
    expect(secondBackoffMs).toBe('60000')
  })

  it('syncs only data after the last successful sync', async () => {
    const db = createDb('incremental')
    const configDir = createTempDir('config-incremental')
    writeConfig(createConfig(), configDir)
    upsertDaemonSession(db, createSession({ session_id: 'ses_1', last_seen_at: '2026-04-03T01:00:00.000Z' }))
    upsertDaemonSession(db, createSession({ session_id: 'ses_2', last_seen_at: '2026-04-03T02:00:00.000Z' }))
    insertConversationEvents(db, [
      createEvent({ session_id: 'ses_1', timestamp: '2026-04-03T01:00:00.000Z', content_preview: 'one' }),
      createEvent({ session_id: 'ses_2', timestamp: '2026-04-03T02:00:00.000Z', content_preview: 'two' }),
    ])
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchMock)
    const cloudSync = new CloudSync(db, configDir)

    await cloudSync.tick()
    await cloudSync.tick()

    const secondPayload = JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string) as SyncPayload
    expect(secondPayload.sessions).toEqual([])
    expect(secondPayload.events).toEqual([])
  })
})
