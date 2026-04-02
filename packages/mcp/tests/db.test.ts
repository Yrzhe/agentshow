import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { SESSION_TIMEOUT_MS } from '@agentshow/shared'
import { getDb } from '../src/db/connection.js'
import {
  deleteNote,
  getActiveSessionsByProject,
  getActiveSessionsSummary,
  getNotesByProject,
  getSessionHistory,
  insertSession,
  insertSessionHistory,
  markInactive,
  markStaleSessionsInactive,
  updateSession,
  upsertNote,
} from '../src/db/queries.js'
import { initSchema } from '../src/db/schema.js'

const tempDirs: string[] = []
const openDbs: Database.Database[] = []

function createTempDbPath(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `agentshow-${name}-`))
  tempDirs.push(dir)
  return join(dir, 'agentshow.db')
}

function trackDb(db: Database.Database): Database.Database {
  openDbs.push(db)
  return db
}

afterEach(() => {
  while (openDbs.length > 0) {
    const db = openDbs.pop()
    if (!db) {
      continue
    }

    if (db.open) {
      db.close()
    }
  }

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (!dir) {
      continue
    }

    rmSync(dir, { recursive: true, force: true })
  }
})

describe('database layer', () => {
  it('creates tables and indexes when initializing schema', () => {
    const dbPath = createTempDbPath('schema')
    const db = trackDb(new Database(dbPath))

    initSchema(db)

    const tables = db
      .prepare(
        `
          SELECT name
          FROM sqlite_master
          WHERE type = 'table'
        `,
      )
      .all() as Array<{ name: string }>
    const indexes = db
      .prepare(
        `
          SELECT name
          FROM sqlite_master
          WHERE type = 'index'
        `,
      )
      .all() as Array<{ name: string }>

    expect(tables.map((table) => table.name)).toEqual(
      expect.arrayContaining(['sessions', 'notes', 'session_history']),
    )
    expect(indexes.map((index) => index.name)).toEqual(
      expect.arrayContaining([
        'idx_sessions_project',
        'idx_notes_project',
        'idx_history_project',
      ]),
    )
    expect(db.pragma('user_version', { simple: true })).toBe(1)
  })

  it('supports session CRUD operations', () => {
    const dbPath = createTempDbPath('sessions')
    const db = trackDb(getDb(dbPath))

    insertSession(db, {
      id: 'ses_1',
      project_id: 'proj_1',
      project_name: 'pagefly',
      cwd: '/tmp/project',
      task: 'initial task',
      files: JSON.stringify(['a.ts']),
      conversation_path: '/tmp/conversation.jsonl',
      status: 'active',
    })

    const initialSessions = getActiveSessionsByProject(db, 'proj_1')
    expect(initialSessions).toHaveLength(1)
    expect(initialSessions[0]?.task).toBe('initial task')

    updateSession(db, 'ses_1', {
      task: 'updated task',
      files: JSON.stringify(['a.ts', 'b.ts']),
    })

    const updatedSessions = getActiveSessionsByProject(db, 'proj_1')
    expect(updatedSessions[0]?.task).toBe('updated task')
    expect(updatedSessions[0]?.files).toBe(JSON.stringify(['a.ts', 'b.ts']))

    markInactive(db, 'ses_1')
    expect(getActiveSessionsByProject(db, 'proj_1')).toHaveLength(0)
  })

  it('upserts notes without creating duplicates', () => {
    const dbPath = createTempDbPath('notes-upsert')
    const db = trackDb(getDb(dbPath))

    const created = upsertNote(db, 'proj_1', 'ses_1', 'schema', 'v1')
    const updated = upsertNote(db, 'proj_1', 'ses_2', 'schema', 'v2')

    const notes = getNotesByProject(db, 'proj_1')

    expect(created.status).toBe('created')
    expect(updated.status).toBe('updated')
    expect(updated.id).toBe(created.id)
    expect(notes).toHaveLength(1)
    expect(notes[0]?.content).toBe('v2')
    expect(notes[0]?.session_id).toBe('ses_2')
  })

  it('filters notes by search and since', () => {
    const dbPath = createTempDbPath('notes-search')
    const db = trackDb(getDb(dbPath))

    upsertNote(db, 'proj_1', 'ses_1', 'schema', 'database schema change')
    upsertNote(db, 'proj_1', 'ses_1', 'ui', 'landing page update')
    upsertNote(db, 'proj_1', 'ses_1', 'api', 'endpoint tweak')

    db.prepare(
      `
        UPDATE notes
        SET updated_at = '2026-04-01 00:00:00'
        WHERE key = 'schema'
      `,
    ).run()

    const searchResults = getNotesByProject(db, 'proj_1', { search: 'schema' })
    const sinceResults = getNotesByProject(db, 'proj_1', {
      since: '2026-04-02 00:00:00',
    })

    expect(searchResults).toHaveLength(1)
    expect(searchResults[0]?.key).toBe('schema')
    expect(sinceResults.map((note) => note.key).sort()).toEqual(['api', 'ui'])
  })

  it('deletes notes and returns whether the row existed', () => {
    const dbPath = createTempDbPath('notes-delete')
    const db = trackDb(getDb(dbPath))

    upsertNote(db, 'proj_1', 'ses_1', 'schema', 'v1')

    expect(deleteNote(db, 'proj_1', 'schema')).toBe(true)
    expect(deleteNote(db, 'proj_1', 'schema')).toBe(false)
  })

  it('marks stale sessions inactive based on heartbeat timeout', () => {
    const dbPath = createTempDbPath('stale')
    const db = trackDb(getDb(dbPath))

    insertSession(db, {
      id: 'ses_stale',
      project_id: 'proj_1',
      project_name: 'pagefly',
      cwd: '/tmp/project',
      task: 'stale task',
      files: null,
      conversation_path: null,
      status: 'active',
    })

    db.prepare(
      `
        UPDATE sessions
        SET last_heartbeat = datetime('now', '-31 minutes')
        WHERE id = 'ses_stale'
      `,
    ).run()

    const staleIds = markStaleSessionsInactive(db, SESSION_TIMEOUT_MS)

    expect(staleIds).toEqual(['ses_stale'])
    expect(getActiveSessionsByProject(db, 'proj_1')).toHaveLength(0)
  })

  it('stores and retrieves session history', () => {
    const dbPath = createTempDbPath('history')
    const db = trackDb(getDb(dbPath))

    insertSession(db, {
      id: 'ses_history',
      project_id: 'proj_1',
      project_name: 'pagefly',
      cwd: '/tmp/project',
      task: 'build database layer',
      files: JSON.stringify(['queries.ts']),
      conversation_path: '/tmp/history.jsonl',
      status: 'active',
    })

    markInactive(db, 'ses_history')
    insertSessionHistory(db, {
      id: 'ses_history',
      project_id: 'proj_1',
      project_name: 'pagefly',
      task: 'build database layer',
      summary: 'implemented schema and queries',
      conversation_path: '/tmp/history.jsonl',
      started_at: '2026-04-02 10:00:00',
    })

    const history = getSessionHistory(db, 'proj_1', { search: 'schema' })

    expect(history).toHaveLength(1)
    expect(history[0]?.id).toBe('ses_history')
    expect(history[0]?.summary).toContain('schema')
  })

  it('supports concurrent access with WAL enabled', () => {
    const dbPath = createTempDbPath('wal')
    const db1 = trackDb(getDb(dbPath))
    const db2 = trackDb(new Database(dbPath))

    initSchema(db2)

    expect(db1.pragma('journal_mode', { simple: true })).toBe('wal')

    insertSession(db1, {
      id: 'ses_concurrent',
      project_id: 'proj_1',
      project_name: 'pagefly',
      cwd: '/tmp/project',
      task: 'writer task',
      files: null,
      conversation_path: null,
      status: 'active',
    })

    const sessionsFromDb2 = getActiveSessionsByProject(db2, 'proj_1')
    const noteResult = upsertNote(db2, 'proj_1', 'ses_concurrent', 'wal', 'enabled')
    const summary = getActiveSessionsSummary(db1)

    expect(sessionsFromDb2).toHaveLength(1)
    expect(noteResult.status).toBe('created')
    expect(summary).toEqual([
      {
        project_id: 'proj_1',
        project_name: 'pagefly',
        active_sessions: 1,
        notes_count: 1,
      },
    ])
  })
})
