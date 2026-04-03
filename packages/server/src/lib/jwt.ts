import jwt from 'jsonwebtoken'

export interface JwtPayload {
  user_id: string
  github_login: string
  exp: number
}

export async function signJwt(payload: JwtPayload, secret: string): Promise<string> {
  return jwt.sign(payload, secret, { algorithm: 'HS256', noTimestamp: true })
}

export async function verifyJwt(token: string, secret: string): Promise<JwtPayload | null> {
  try {
    const payload = jwt.verify(token, secret, { algorithms: ['HS256'] }) as JwtPayload
    return payload
  } catch {
    return null
  }
}
