import { describe, expect, it } from 'vitest'
import app from '../src/index.js'
import { hashToken } from '../src/middleware/auth.js'
import { MockD1Database } from './helpers/mock-d1.js'

describe('worker sessions api', () => {
  it('lists sessions and filters by status', async () => {
    const db = await createSeededDb()
    const allResponse = await app.request('/api/sessions', authInit('as_token'), env(db))
    const activeResponse = await app.request('/api/sessions?status=active', authInit('as_token'), env(db))

    expect((await allResponse.json()).sessions).toHaveLength(2)
    expect((await activeResponse.json()).sessions).toEqual([
      expect.objectContaining({ session_id: 'ses_active' }),
    ])
  })

  it('returns session detail, stats, and projects', async () => {
    const db = await createSeededDb()
    const detailResponse = await app.request('/api/sessions/ses_active', authInit('as_token'), env(db))
    const statsResponse = await app.request('/api/sessions/ses_active/stats', authInit('as_token'), env(db))
    const projectsResponse = await app.request('/api/projects', authInit('as_token'), env(db))

    expect((await detailResponse.json()).events).toHaveLength(1)
    expect(await statsResponse.json()).toMatchObject({
      message_count: 3,
      total_input_tokens: 5,
      total_output_tokens: 7,
    })
    expect((await projectsResponse.json()).projects).toEqual([
      expect.objectContaining({ project_slug: '-tmp-project', total_sessions: 2 }),
    ])
  })
})

async function createSeededDb(): Promise<MockD1Database> {
  const db = new MockD1Database()
  db.seedToken({
    id: 'tok_1',
    user_id: 'user_1',
    prefix: 'as_',
    token_hash: await hashToken('as_token'),
  })

  await app.request(
    '/api/sync',
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer as_token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        device_id: 'dev_1',
        synced_at: new Date().toISOString(),
        sessions: [
          {
            session_id: 'ses_active',
            pid: 1,
            cwd: '/tmp/project',
            project_slug: '-tmp-project',
            status: 'active',
            started_at: '2026-04-03T00:00:00.000Z',
            last_seen_at: '2026-04-03T01:00:00.000Z',
            message_count: 3,
            total_input_tokens: 5,
            total_output_tokens: 7,
            tool_calls: 1,
          },
          {
            session_id: 'ses_ended',
            pid: 2,
            cwd: '/tmp/project',
            project_slug: '-tmp-project',
            status: 'ended',
            started_at: '2026-04-03T00:00:00.000Z',
            last_seen_at: '2026-04-03T00:30:00.000Z',
            message_count: 1,
            total_input_tokens: 1,
            total_output_tokens: 1,
            tool_calls: 0,
          },
        ],
        events: [
          {
            local_id: 1,
            session_id: 'ses_active',
            type: 'assistant',
            role: 'assistant',
            tool_name: null,
            input_tokens: 1,
            output_tokens: 2,
            model: 'claude',
            timestamp: '2026-04-03T01:00:00.000Z',
            content_preview: 'hello',
          },
        ],
      }),
    },
    env(db),
  )

  return db
}

function authInit(token: string): RequestInit {
  return {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  }
}

function env(DB: MockD1Database) {
  return {
    DB: DB as unknown as D1Database,
    GITHUB_CLIENT_ID: '',
    GITHUB_CLIENT_SECRET: '',
    JWT_SECRET: 'secret',
  }
}
