import { describe, expect, it } from 'vitest'
import app from '../src/index.js'
import { hashToken } from '../src/middleware/auth.js'
import { MockD1Database } from './helpers/mock-d1.js'

describe('worker sync api', () => {
  it('returns 401 without auth', async () => {
    const response = await app.request(
      '/api/sync',
      createSyncRequest([], []),
      env(new MockD1Database()),
    )

    expect(response.status).toBe(401)
  })

  it('accepts an empty payload with a valid token', async () => {
    const db = await createAuthedDb()
    const response = await app.request('/api/sync', createSyncRequest([], [], 'as_token'), env(db))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      status: 'ok',
      accepted_sessions: 0,
      accepted_events: 0,
    })
  })

  it('syncs sessions into cloud storage', async () => {
    const db = await createAuthedDb()
    await app.request('/api/sync', createSyncRequest([baseSession('ses_1')], [], 'as_token'), env(db))

    expect(db.listSessions()).toEqual([
      expect.objectContaining({ session_id: 'ses_1', user_id: 'user_1' }),
    ])
  })

  it('deduplicates repeated events using the watermark', async () => {
    const db = await createAuthedDb()
    const events = [baseEvent(1)]

    await app.request('/api/sync', createSyncRequest([baseSession('ses_1')], events, 'as_token'), env(db))
    const response = await app.request('/api/sync', createSyncRequest([], events, 'as_token'), env(db))

    expect(response.status).toBe(200)
    expect(db.listEvents()).toHaveLength(1)
  })
})

function baseSession(session_id: string) {
  return {
    session_id,
    pid: 1,
    cwd: '/tmp/project',
    project_slug: '-tmp-project',
    status: 'active',
    started_at: '2026-04-03T00:00:00.000Z',
    last_seen_at: '2026-04-03T01:00:00.000Z',
    message_count: 1,
    total_input_tokens: 2,
    total_output_tokens: 3,
    tool_calls: 0,
  }
}

function baseEvent(local_id: number) {
  return {
    local_id,
    session_id: 'ses_1',
    type: 'assistant',
    role: 'assistant',
    tool_name: null,
    input_tokens: 1,
    output_tokens: 2,
    model: 'claude',
    timestamp: '2026-04-03T01:00:00.000Z',
    content_preview: 'hello',
  }
}

function createSyncRequest(sessions: unknown[], events: unknown[], token?: string): RequestInit {
  return {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      device_id: 'dev_1',
      synced_at: new Date().toISOString(),
      sessions,
      events,
    }),
  }
}

async function createAuthedDb(): Promise<MockD1Database> {
  const db = new MockD1Database()
  db.seedToken({
    id: 'tok_1',
    user_id: 'user_1',
    prefix: 'as_',
    token_hash: await hashToken('as_token'),
  })
  return db
}

function env(DB: MockD1Database) {
  return {
    DB: DB as unknown as D1Database,
    GITHUB_CLIENT_ID: '',
    GITHUB_CLIENT_SECRET: '',
    JWT_SECRET: 'secret',
  }
}
