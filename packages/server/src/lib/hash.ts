import { createHash } from 'node:crypto'

export async function sha256Hex(value: string): Promise<string> {
  return createHash('sha256').update(value).digest('hex')
}
