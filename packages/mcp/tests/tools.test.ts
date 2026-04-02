import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PROJECT_IDENTITY_FILE, SESSION_TIMEOUT_MS } from '@agentshow/shared'
import { getDb } from '../src/db/connection.js'
import {
  getActiveSessionsByProject,
  getNotesByProject,
  getSessionHistory,
  insertSessionHistory,
} from '../src/db/queries.js'
import { handleGetPeers } from '../src/tools/get-peers.js'
import {
  handleDeleteNote,
  handleGetNotes,
  handleShareNote,
} from '../src/tools/notes.js'
import { handleGetProjectHistory } from '../src/tools/project-history.js'
import { handleRegisterStatus, type ToolContext } from '../src/tools/register-status.js'

const tempDirs: string[] = []
const openDbs: ReturnType<typeof getDb>[] = []

function createTempDir(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `agentshow-tools-${name}-`))
  tempDirs.push(dir)
  return dir
}

function createProjectDir(name: string, cwdName = name): string {
  const root = createTempDir(name)
  const cwd = join(root, cwdName)
  mkdirSync(cwd, { recursive: true })
  return cwd
}

function createDb() {
  const dir = createTempDir('db')
  const db = getDb(join(dir, 'agentshow.db'))
  openDbs.push(db)
  return db
}

function createContext(db: ReturnType<typeof getDb>): ToolContext {
  return {
    db,
    sessionId: null,
    projectId: null,
  }
}

function syncContext(ctx: ToolContext, output: { session_id: string; project_id: string }): void {
  ctx.sessionId = output.session_id
  ctx.projectId = output.project_id
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

describe('tool handlers', () => {
  it('register_status first call creates a session record', () => {
    const db = createDb()
    const cwd = createProjectDir('register-first')
    const ctx = createContext(db)

    const output = handleRegisterStatus({ cwd, task: 'setup' }, ctx)
    syncContext(ctx, output)

    const sessions = getActiveSessionsByProject(db, output.project_id)
    expect(output.status).toBe('registered')
    expect(output.session_id.startsWith('ses_')).toBe(true)
    expect(output.project_id.startsWith('proj_')).toBe(true)
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.conversation_path).toContain(`${output.session_id}.jsonl`)
  })

  it('register_status update modifies task and heartbeat', async () => {
    const db = createDb()
    const cwd = createProjectDir('register-update')
    const ctx = createContext(db)

    const first = handleRegisterStatus({ cwd, task: 'initial' }, ctx)
    syncContext(ctx, first)

    const before = getActiveSessionsByProject(db, first.project_id)[0]
    await new Promise((resolve) => setTimeout(resolve, 10))

    const updated = handleRegisterStatus({ task: 'updated' }, ctx)
    const after = getActiveSessionsByProject(db, first.project_id)[0]

    expect(updated.status).toBe('updated')
    expect(after?.task).toBe('updated')
    expect(new Date(after?.last_heartbeat ?? 0).getTime()).toBeGreaterThanOrEqual(
      new Date(before?.last_heartbeat ?? 0).getTime(),
    )
  })

  it('get_peers returns other active sessions in the same project', () => {
    const db = createDb()
    const root = createTempDir('same-project')
    writeFileSync(
      join(root, PROJECT_IDENTITY_FILE),
      JSON.stringify({ id: 'proj_shared', name: 'shared-project' }),
      'utf8',
    )
    const cwdA = join(root, 'a')
    const cwdB = join(root, 'b')
    mkdirSync(cwdA, { recursive: true })
    mkdirSync(cwdB, { recursive: true })

    const ctxA = createContext(db)
    const ctxB = createContext(db)
    syncContext(ctxA, handleRegisterStatus({ cwd: cwdA, task: 'task a' }, ctxA))
    syncContext(ctxB, handleRegisterStatus({ cwd: cwdB, task: 'task b' }, ctxB))

    const peersA = handleGetPeers({}, ctxA)
    const peersB = handleGetPeers({}, ctxB)

    expect('peers' in peersA && peersA.peers).toHaveLength(1)
    expect('peers' in peersB && peersB.peers).toHaveLength(1)
    expect('peers' in peersA && peersA.peers[0]?.task).toBe('task b')
    expect('peers' in peersB && peersB.peers[0]?.task).toBe('task a')
  })

  it('get_peers scope=all returns project summaries', () => {
    const db = createDb()
    const ctxA = createContext(db)
    const ctxB = createContext(db)

    syncContext(ctxA, handleRegisterStatus({ cwd: createProjectDir('alpha'), task: 'a' }, ctxA))
    syncContext(ctxB, handleRegisterStatus({ cwd: createProjectDir('beta'), task: 'b' }, ctxB))

    const output = handleGetPeers({ scope: 'all' }, ctxA)

    expect('projects' in output && output.projects).toHaveLength(2)
    expect('projects' in output && output.projects.map((project) => project.name).sort()).toEqual([
      'alpha',
      'beta',
    ])
  })

  it('get_peers scope=all includes projects that only have history', () => {
    const db = createDb()
    const ctx = createContext(db)
    const registered = handleRegisterStatus({ cwd: createProjectDir('active-project'), task: 'active' }, ctx)
    syncContext(ctx, registered)

    insertSessionHistory(db, {
      id: 'ses_history_only',
      project_id: 'proj_history_only',
      project_name: 'history-only',
      task: 'past task',
      summary: 'completed earlier',
      conversation_path: null,
      started_at: '2026-04-01 09:00:00',
    })

    handleShareNote({ key: 'history-note', content: 'kept for later' }, {
      ...ctx,
      projectId: 'proj_history_only',
      sessionId: null,
    })

    const output = handleGetPeers({ scope: 'all' }, ctx)

    expect('projects' in output && output.projects).toHaveLength(2)
    expect('projects' in output && output.projects).toEqual([
      expect.objectContaining({
        project_id: registered.project_id,
        name: 'active-project',
        active_sessions: 1,
      }),
      expect.objectContaining({
        project_id: 'proj_history_only',
        name: 'history-only',
        active_sessions: 0,
        notes_count: 1,
      }),
    ])
  })

  it('share_note and get_notes support create then update', () => {
    const db = createDb()
    const ctx = createContext(db)
    syncContext(ctx, handleRegisterStatus({ cwd: createProjectDir('notes'), task: 'notes' }, ctx))

    const created = handleShareNote({ key: 'schema', content: 'v1' }, ctx)
    const updated = handleShareNote({ key: 'schema', content: 'v2' }, ctx)
    const notes = handleGetNotes({}, ctx)

    expect(created.status).toBe('created')
    expect(updated.status).toBe('updated')
    expect(notes.notes).toHaveLength(1)
    expect(notes.notes[0]?.content).toBe('v2')
  })

  it('delete_note removes shared notes', () => {
    const db = createDb()
    const ctx = createContext(db)
    syncContext(ctx, handleRegisterStatus({ cwd: createProjectDir('delete-note') }, ctx))

    handleShareNote({ key: 'temp', content: 'remove me' }, ctx)
    const deleted = handleDeleteNote({ key: 'temp' }, ctx)
    const notes = handleGetNotes({}, ctx)

    expect(deleted.status).toBe('deleted')
    expect(notes.notes).toHaveLength(0)
  })

  it('get_notes search filters notes correctly', () => {
    const db = createDb()
    const ctx = createContext(db)
    syncContext(ctx, handleRegisterStatus({ cwd: createProjectDir('search-notes') }, ctx))

    handleShareNote({ key: 'schema', content: 'database schema change' }, ctx)
    handleShareNote({ key: 'ui', content: 'design update' }, ctx)

    const notes = handleGetNotes({ search: 'schema' }, ctx)

    expect(notes.notes).toHaveLength(1)
    expect(notes.notes[0]?.key).toBe('schema')
  })

  it('get_project_history merges session history and notes', () => {
    const db = createDb()
    const ctx = createContext(db)
    const registered = handleRegisterStatus({ cwd: createProjectDir('history-project') }, ctx)
    syncContext(ctx, registered)
    handleShareNote({ key: 'history-note', content: 'important detail' }, ctx)

    insertSessionHistory(db, {
      id: 'ses_old',
      project_id: registered.project_id,
      project_name: registered.project_name,
      task: 'old task',
      summary: 'schema work',
      conversation_path: null,
      started_at: '2026-04-01 10:00:00',
    })

    const output = handleGetProjectHistory({}, ctx)

    expect(output.sessions).toHaveLength(1)
    expect(output.notes).toHaveLength(1)
    expect(output.sessions[0]?.summary).toBe('schema work')
    expect(output.notes[0]?.key).toBe('history-note')
  })

  it('get_peers lazily cleans up stale sessions', () => {
    const db = createDb()
    const root = createTempDir('stale-project')
    writeFileSync(
      join(root, PROJECT_IDENTITY_FILE),
      JSON.stringify({ id: 'proj_stale', name: 'stale-project' }),
      'utf8',
    )
    const cwdA = join(root, 'a')
    const cwdB = join(root, 'b')
    mkdirSync(cwdA, { recursive: true })
    mkdirSync(cwdB, { recursive: true })

    const ctxA = createContext(db)
    const ctxB = createContext(db)
    const registeredA = handleRegisterStatus({ cwd: cwdA, task: 'stale soon' }, ctxA)
    syncContext(ctxA, registeredA)
    syncContext(ctxB, handleRegisterStatus({ cwd: cwdB, task: 'still active' }, ctxB))

    db.prepare(
      `
        UPDATE sessions
        SET last_heartbeat = datetime('now', '-31 minutes')
        WHERE id = ?
      `,
    ).run(registeredA.session_id)

    const peersB = handleGetPeers({}, ctxB)
    const activeSessions = getActiveSessionsByProject(db, ctxB.projectId ?? '')

    expect('peers' in peersB && peersB.peers).toHaveLength(0)
    expect(activeSessions).toHaveLength(1)
    expect(activeSessions[0]?.id).toBe(ctxB.sessionId)
  })
})
