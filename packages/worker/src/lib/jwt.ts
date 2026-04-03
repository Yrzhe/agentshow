export interface JwtPayload {
  user_id: string
  github_login: string
  exp: number
}

const JWT_HEADER = { alg: 'HS256', typ: 'JWT' }

export async function signJwt(payload: JwtPayload, secret: string): Promise<string> {
  const encodedHeader = base64urlEncode(JSON.stringify(JWT_HEADER))
  const encodedPayload = base64urlEncode(JSON.stringify(payload))
  const signingInput = `${encodedHeader}.${encodedPayload}`
  const signature = await signHmac(signingInput, secret)
  return `${signingInput}.${base64urlEncode(signature)}`
}

export async function verifyJwt(token: string, secret: string): Promise<JwtPayload | null> {
  const [encodedHeader, encodedPayload, encodedSignature] = token.split('.')

  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    return null
  }

  const signingInput = `${encodedHeader}.${encodedPayload}`
  const key = await importHmacKey(secret)
  const isValid = await crypto.subtle.verify(
    'HMAC',
    key,
    base64urlDecode(encodedSignature),
    new TextEncoder().encode(signingInput),
  )

  if (!isValid) {
    return null
  }

  const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(encodedPayload))) as JwtPayload
  if (payload.exp <= Math.floor(Date.now() / 1000)) {
    return null
  }

  return payload
}

export function base64urlEncode(data: ArrayBuffer | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data)
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '')
}

export function base64urlDecode(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
  const binary = atob(padded)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

async function signHmac(value: string, secret: string): Promise<ArrayBuffer> {
  const key = await importHmacKey(secret)
  return crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}
