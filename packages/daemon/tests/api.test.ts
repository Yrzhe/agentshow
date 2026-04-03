import { mkdtempSync, rmSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import type { DaemonSession, MessageRecord } from '@agentshow/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApiServer } from '../src/api/server.js'
import { getDaemonDb } from '../src/db/connection.js'
import { insertConversationEvents, upsertDaemonSession } from '../src/db/queries.js'

let tempDir = ''
let db: Database.Database
let server: ReturnType<typeof createApiServer>
let baseUrl = ''

function createSession(overrides: Partial<DaemonSession> = {}): DaemonSession {
  return {
    session_id: 'ses_1',
    pid: 111,
    cwd: '/tmp/project-a',
    project_slug: 'project-a',
    status: 'active',
    started_at: '2026-04-03 10:00:00',
    last_seen_at: '2026-04-03 10:00:00',
    conversation_path: '/tmp/project-a/conv.jsonl',
    message_count: 2,
    total_input_tokens: 30,
    total_output_tokens: 70,
    tool_calls: 1,
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
    input_tokens: 10,
    output_tokens: 20,
    model: 'claude',
    timestamp: '2026-04-03T10:00:00.000Z',
    ...overrides,
  }
}

async function getJson(path: string) {
  const response = await fetch(`${baseUrl}${path}`)
  return { status: response.status, body: await response.json() as Record<string, unknown> }
}

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'agentshow-api-'))
  db = getDaemonDb(join(tempDir, 'agentshow.db'))
  server = createApiServer(db, 0)

  await new Promise<void>((resolve) => {
    server.listen(0, resolve)
  })

  const address = server.address() as AddressInfo
  baseUrl = `http://${address.address}:${address.port}`
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })

  if (db.open) {
    db.close()
  }

  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

describe('daemon api server', () => {
  it('returns health status', async () => {
    const { status, body } = await getJson('/health')

    expect(status).toBe(200)
    expect(body.status).toBe('ok')
    expect(typeof body.uptime).toBe('number')
  })

  it('returns empty sessions for an empty database', async () => {
    const { body } = await getJson('/sessions')
    expect(body.sessions).toEqual([])
  })

  it('returns inserted sessions', async () => {
    upsertDaemonSession(db, createSession())
    upsertDaemonSession(db, createSession({
      session_id: 'ses_2',
      pid: 222,
      cwd: '/tmp/project-b',
      project_slug: 'project-b',
      status: 'ended',
      total_input_tokens: 5,
      total_output_tokens: 15,
    }))

    const { body } = await getJson('/sessions')
    const sessions = body.sessions as DaemonSession[]

    expect(sessions.map((session) => session.session_id)).toEqual(['ses_1', 'ses_2'])
  })

  it('filters sessions by status', async () => {
    const { body } = await getJson('/sessions?status=active')
    const sessions = body.sessions as DaemonSession[]

    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.session_id).toBe('ses_1')
  })

  it('returns a single session with recent events', async () => {
    insertConversationEvents(db, [
      createEvent({ content_preview: 'first', timestamp: '2026-04-03T10:00:00.000Z' }),
      createEvent({ content_preview: 'second', timestamp: '2026-04-03T10:01:00.000Z' }),
    ])

    const { body } = await getJson('/sessions/ses_1')

    expect((body.session as DaemonSession).session_id).toBe('ses_1')
    expect((body.recent_events as MessageRecord[]).map((event) => event.content_preview)).toEqual([
      'first',
      'second',
    ])
  })

  it('returns session stats', async () => {
    const { body } = await getJson('/sessions/ses_1/stats')

    expect(body).toEqual({
      session_id: 'ses_1',
      message_count: 2,
      total_input_tokens: 30,
      total_output_tokens: 70,
      tool_calls: 1,
    })
  })

  it('aggregates projects by slug', async () => {
    upsertDaemonSession(db, createSession({
      session_id: 'ses_3',
      pid: 333,
      status: 'active',
      total_input_tokens: 20,
      total_output_tokens: 10,
    }))

    const { body } = await getJson('/projects')
    const projects = body.projects as Array<Record<string, unknown>>

    expect(projects).toEqual([
      {
        project_slug: 'project-a',
        cwd: '/tmp/project-a',
        active_sessions: 2,
        total_tokens: 130,
      },
      {
        project_slug: 'project-b',
        cwd: '/tmp/project-b',
        active_sessions: 0,
        total_tokens: 20,
      },
    ])
  })

  it('returns 404 for unknown routes', async () => {
    const { status, body } = await getJson('/unknown')

    expect(status).toBe(404)
    expect(body).toEqual({ error: 'Not Found' })
  })

  it('binds the server to 127.0.0.1', () => {
    const address = server.address() as AddressInfo
    expect(address.address).toBe('127.0.0.1')
  })
})
