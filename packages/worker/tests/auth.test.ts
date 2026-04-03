import { describe, expect, it } from 'vitest'
import { sha256Hex } from '../src/lib/hash.js'
import { generateId } from '../src/lib/id.js'
import { signJwt, verifyJwt } from '../src/lib/jwt.js'

describe('worker auth helpers', () => {
  it('signs and verifies jwt payloads', async () => {
    const token = await signJwt(
      {
        user_id: 'user_1',
        github_login: 'yrzhe',
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      'secret',
    )

    await expect(verifyJwt(token, 'secret')).resolves.toEqual({
      user_id: 'user_1',
      github_login: 'yrzhe',
      exp: expect.any(Number),
    })
  })

  it('returns null for expired jwt payloads', async () => {
    const token = await signJwt(
      {
        user_id: 'user_1',
        github_login: 'yrzhe',
        exp: Math.floor(Date.now() / 1000) - 1,
      },
      'secret',
    )

    await expect(verifyJwt(token, 'secret')).resolves.toBeNull()
  })

  it('produces stable token hashes', async () => {
    const [first, second, third] = await Promise.all([
      sha256Hex('as_example_token'),
      sha256Hex('as_example_token'),
      sha256Hex('as_other_token'),
    ])

    expect(first).toBe(second)
    expect(first).not.toBe(third)
  })

  it('generates ids with the requested length and charset', () => {
    const value = generateId(24)

    expect(value).toHaveLength(24)
    expect(value).toMatch(/^[A-Za-z0-9]+$/u)
  })
})
