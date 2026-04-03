import { randomBytes } from 'node:crypto'

const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

export function generateId(length = 12): string {
  const bytes = randomBytes(length)
  return Array.from(bytes, (byte) => ID_CHARS[byte % ID_CHARS.length]).join('')
}

export function generateApiToken(length = 32): string {
  return `as_${generateId(length)}`
}
