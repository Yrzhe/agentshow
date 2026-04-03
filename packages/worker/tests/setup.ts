import { webcrypto } from 'node:crypto'

if (typeof globalThis.crypto === 'undefined') {
  // @ts-expect-error -- Node.js webcrypto is compatible enough for Workers tests
  globalThis.crypto = webcrypto
}
