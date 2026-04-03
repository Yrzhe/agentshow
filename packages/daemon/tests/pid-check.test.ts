import { describe, expect, it } from 'vitest'
import { isPidAlive } from '../src/discovery/pid-check.js'

describe('isPidAlive', () => {
  it('returns true for the current process pid', () => {
    expect(isPidAlive(process.pid)).toBe(true)
  })

  it('returns false for a nonexistent pid', () => {
    expect(isPidAlive(999999)).toBe(false)
  })

  it('returns false for invalid pids', () => {
    expect(isPidAlive(-1)).toBe(false)
  })
})
