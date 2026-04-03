import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentShowConfig, DaemonSession, SyncPayload } from '@agentshow/shared'
import { writeConfig } from '@agentshow/shared'
import { getDaemonDb } from '../src/db/connection.js'
import {
  getMcpNotes,
  getMcpNotesModifiedSince,
  getMcpSessionByCwd,
  getSyncState,
  upsertDaemonSession,
} from '../src/db/queries.js'
import { CloudSync } from '../src/sync/cloud-sync.js'

const tempDirs: string[] = []
const openDbs: Database.Database[] = []

function createTempDir(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `agentshow-mcp-bridge-${name}-`))
  tempDirs.push(dir)
  return dir
}

function createDb(name: string): Database.Database {
  const db = getDaemonDb(join(createTempDir(name), 'agentshow.db'))
  openDbs.push(db)
  initMcpTables(db)
  return db
}

function initMcpTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      project_name TEXT NOT NULL,
      cwd TEXT NOT NULL,
      task TEXT,
      files TEXT,
      conversation_path TEXT,
      status TEXT DEFAULT 'active',
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_heartbeat DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      session_id TEXT,
      key TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(project_id, key)
    )
  `)
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

function createDaemonSession(overrides: Partial<DaemonSession> = {}): DaemonSession {
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

function insertMcpSession(
  db: Database.Database,
  opts: {
    id?: string
    project_id?: string
    project_name?: string
    cwd?: string
    task?: string | null
    files?: string | null
    status?: string
    last_heartbeat?: string
  } = {},
): void {
  db.prepare(
    `INSERT INTO sessions (id, project_id, project_name, cwd, task, files, status, last_heartbeat)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    opts.id ?? 'mcp_ses_1',
    opts.project_id ?? 'proj_1',
    opts.project_name ?? 'test-project',
    opts.cwd ?? '/tmp/project',
    opts.task ?? 'Fix the bug',
    opts.files ?? '["src/main.ts"]',
    opts.status ?? 'active',
    opts.last_heartbeat ?? '2026-04-03T01:00:00.000Z',
  )
}

function insertMcpNote(
  db: Database.Database,
  opts: {
    project_id?: string
    session_id?: string | null
    key?: string
    content?: string
    created_at?: string
    updated_at?: string
  } = {},
): void {
  db.prepare(
    `INSERT INTO notes (project_id, session_id, key, content, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    opts.project_id ?? 'proj_1',
    opts.session_id ?? null,
    opts.key ?? 'test-note',
    opts.content ?? 'note content',
    opts.created_at ?? '2026-04-03T00:00:00',
    opts.updated_at ?? '2026-04-03T00:00:00',
  )
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

describe('MCP bridge queries', () => {
  it('getMcpNotes returns notes from MCP notes table', () => {
    const db = createDb('get-notes')
    insertMcpNote(db, { key: 'note-a', content: 'alpha' })
    insertMcpNote(db, { key: 'note-b', content: 'beta' })

    const notes = getMcpNotes(db)

    expect(notes).toHaveLength(2)
    expect(notes[0]?.key).toBe('note-a')
    expect(notes[0]?.content).toBe('alpha')
    expect(notes[1]?.key).toBe('note-b')
  })

  it('getMcpNotesModifiedSince filters by date', () => {
    const db = createDb('notes-since')
    insertMcpNote(db, { key: 'old', updated_at: '2026-04-01T00:00:00' })
    insertMcpNote(db, { key: 'new', updated_at: '2026-04-03T12:00:00' })

    const notes = getMcpNotesModifiedSince(db, '2026-04-02T00:00:00')

    expect(notes).toHaveLength(1)
    expect(notes[0]?.key).toBe('new')
  })

  it('getMcpSessionByCwd returns matching session', () => {
    const db = createDb('session-by-cwd')
    insertMcpSession(db, { cwd: '/tmp/project', task: 'Do stuff', files: '["a.ts"]' })

    const result = getMcpSessionByCwd(db, '/tmp/project')

    expect(result).not.toBeNull()
    expect(result?.task).toBe('Do stuff')
    expect(result?.files).toBe('["a.ts"]')
  })

  it('getMcpSessionByCwd returns null for non-matching cwd', () => {
    const db = createDb('session-no-match')
    insertMcpSession(db, { cwd: '/tmp/other-project' })

    const result = getMcpSessionByCwd(db, '/tmp/project')

    expect(result).toBeNull()
  })
})

describe('MCP bridge cloud sync', () => {
  it('includes notes in payload when privacy >= 2', async () => {
    const db = createDb('sync-notes')
    const configDir = createTempDir('config-sync-notes')
    writeConfig(createConfig({ privacy: { level: 2 } }), configDir)
    upsertDaemonSession(db, createDaemonSession())
    insertMcpNote(db, { key: 'shared-note', content: 'important data' })
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchMock)

    await new CloudSync(db, configDir).tick()

    const payload = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as SyncPayload
    expect(payload.notes).toHaveLength(1)
    expect(payload.notes?.[0]?.key).toBe('shared-note')
    expect(payload.notes?.[0]?.content).toBe('important data')
  })

  it('enriches sessions with task/files from MCP', async () => {
    const db = createDb('sync-enrich')
    const configDir = createTempDir('config-sync-enrich')
    writeConfig(createConfig({ privacy: { level: 2 } }), configDir)
    upsertDaemonSession(db, createDaemonSession({ cwd: '/tmp/project' }))
    insertMcpSession(db, { cwd: '/tmp/project', task: 'Build feature X', files: '["index.ts"]' })
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchMock)

    await new CloudSync(db, configDir).tick()

    const payload = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as SyncPayload
    expect(payload.sessions[0]?.task).toBe('Build feature X')
    expect(payload.sessions[0]?.files).toBe('["index.ts"]')
  })

  it('excludes notes when privacy < 2', async () => {
    const db = createDb('sync-no-notes')
    const configDir = createTempDir('config-sync-no-notes')
    writeConfig(createConfig({ privacy: { level: 1 } }), configDir)
    upsertDaemonSession(db, createDaemonSession())
    insertMcpNote(db, { key: 'private-note', content: 'secret' })
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchMock)

    await new CloudSync(db, configDir).tick()

    const payload = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as SyncPayload
    expect(payload.notes).toBeUndefined()
  })

  it('updates last_synced_note_at on successful sync with notes', async () => {
    const db = createDb('sync-note-state')
    const configDir = createTempDir('config-sync-note-state')
    writeConfig(createConfig({ privacy: { level: 2 } }), configDir)
    upsertDaemonSession(db, createDaemonSession())
    insertMcpNote(db, { key: 'note-1', updated_at: '2026-04-03T05:00:00' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }))

    await new CloudSync(db, configDir).tick()

    expect(getSyncState(db, 'last_synced_note_at')).toBe('2026-04-03T05:00:00')
  })
})
