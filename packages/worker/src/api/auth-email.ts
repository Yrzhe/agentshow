import { setCookie } from 'hono/cookie'
import { Hono } from 'hono'
import type { AppType } from '../index.js'
import { generateId } from '../lib/id.js'
import { sha256Hex } from '../lib/hash.js'
import { signJwt } from '../lib/jwt.js'
import { isEmailAllowed, upsertUserByEmail } from './auth-github.js'

const CODE_TTL_MINUTES = 10
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60

export const authEmailRoutes = new Hono<AppType>()

function generateCode(): string {
  const bytes = new Uint8Array(3)
  crypto.getRandomValues(bytes)
  const num = ((bytes[0] << 16) | (bytes[1] << 8) | bytes[2]) % 1000000
  return String(num).padStart(6, '0')
}

// POST /email/send — send 6-digit code
authEmailRoutes.post('/email/send', async (c) => {
  if (!c.env.RESEND_API_KEY) {
    return c.json({ error: 'Email login is not configured. Set RESEND_API_KEY.' }, 501)
  }

  const body = await c.req.json<{ email?: string }>()
  const email = body.email?.trim().toLowerCase()

  if (!email) {
    return c.json({ error: 'Email is required' }, 400)
  }

  if (!isEmailAllowed(email, c.env.ALLOWED_EMAILS)) {
    return c.json({ error: 'This email is not in the allowed list.' }, 403)
  }

  const code = generateCode()
  const codeHash = await sha256Hex(code + ':' + email)
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000).toISOString()

  await c.env.DB.prepare(
    `INSERT INTO magic_links (id, email, token_hash, expires_at) VALUES (?, ?, ?, ?)`,
  ).bind(generateId(), email, codeHash, expiresAt).run()

  const resendResponse = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${c.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'AgentShow <noreply@yrzhe.top>',
      to: [email],
      subject: `${code} is your AgentShow login code`,
      html: `<p>Your AgentShow verification code is:</p>
<h1 style="font-size:36px;letter-spacing:8px;font-family:monospace">${code}</h1>
<p>This code expires in ${CODE_TTL_MINUTES} minutes.</p>
<p>If you didn't request this, you can safely ignore this email.</p>`,
    }),
  })

  if (!resendResponse.ok) {
    const err = await resendResponse.text()
    return c.json({ error: `Failed to send email: ${err}` }, 500)
  }

  return c.json({ status: 'sent', message: 'Check your email for a 6-digit code.' })
})

// POST /email/verify — verify 6-digit code
authEmailRoutes.post('/email/verify', async (c) => {
  const body = await c.req.json<{ email?: string; code?: string }>()
  const email = body.email?.trim().toLowerCase()
  const code = body.code?.trim()

  if (!email || !code) {
    return c.json({ error: 'Email and code are required' }, 400)
  }

  const codeHash = await sha256Hex(code + ':' + email)
  const link = await c.env.DB.prepare(
    `SELECT id, email, expires_at, used FROM magic_links WHERE token_hash = ? AND email = ? LIMIT 1`,
  ).bind(codeHash, email).first<{ id: string; email: string; expires_at: string; used: number }>()

  if (!link) {
    return c.json({ error: 'Invalid code' }, 400)
  }

  if (link.used === 1) {
    return c.json({ error: 'This code has already been used' }, 400)
  }

  if (new Date(link.expires_at) < new Date()) {
    return c.json({ error: 'This code has expired' }, 400)
  }

  await c.env.DB.prepare(
    `UPDATE magic_links SET used = 1 WHERE id = ?`,
  ).bind(link.id).run()

  const userId = await upsertUserByEmail(c.env.DB, { email: link.email })

  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
  const jwt = await signJwt({ user_id: userId, github_login: link.email, exp }, c.env.JWT_SECRET)

  setCookie(c, 'session', jwt, {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  })

  return c.json({ status: 'ok', redirect: '/' })
})
