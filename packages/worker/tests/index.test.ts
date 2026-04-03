import { describe, expect, it } from 'vitest'
import app from '../src/index.js'

describe('worker app', () => {
  it('returns health status', async () => {
    const response = await app.request('/api/health')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
  })
})
