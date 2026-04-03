import { setCookie } from 'hono/cookie'
import { Hono } from 'hono'
import type { AppType } from '../index.js'
import { generateId } from '../lib/id.js'
import { sha256Hex } from '../lib/hash.js'
import { signJwt } from '../lib/jwt.js'
import { isEmailAllowed, upsertUserByEmail } from './auth-github.js'

const MAGIC_LINK_TTL_MINUTES = 15
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60

export const authEmailRoutes = new Hono<AppType>()

// POST /email/send — send magic link
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

  const token = `ml_${generateId(32)}`
  const tokenHash = await sha256Hex(token)
  const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MINUTES * 60 * 1000).toISOString()

  await c.env.DB.prepare(
    `INSERT INTO magic_links (id, email, token_hash, expires_at) VALUES (?, ?, ?, ?)`,
  ).bind(generateId(), email, tokenHash, expiresAt).run()

  const origin = new URL(c.req.url).origin
  const verifyUrl = `${origin}/api/auth/email/verify?token=${token}`

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${c.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'AgentShow <noreply@agentshow.dev>',
      to: [email],
      subject: 'Sign in to AgentShow',
      html: `<p>Click the link below to sign in to AgentShow:</p>
<p><a href="${verifyUrl}">${verifyUrl}</a></p>
<p>This link expires in ${MAGIC_LINK_TTL_MINUTES} minutes.</p>
<p>If you didn't request this, you can safely ignore this email.</p>`,
    }),
  })

  return c.json({ status: 'sent', message: 'Check your email for a sign-in link.' })
})

// GET /email/verify — verify magic link token
authEmailRoutes.get('/email/verify', async (c) => {
  const token = c.req.query('token')

  if (!token) {
    return c.json({ error: 'Missing token' }, 400)
  }

  const tokenHash = await sha256Hex(token)
  const link = await c.env.DB.prepare(
    `SELECT id, email, expires_at, used FROM magic_links WHERE token_hash = ? LIMIT 1`,
  ).bind(tokenHash).first<{ id: string; email: string; expires_at: string; used: number }>()

  if (!link) {
    return c.json({ error: 'Invalid or expired link' }, 400)
  }

  if (link.used === 1) {
    return c.json({ error: 'This link has already been used' }, 400)
  }

  if (new Date(link.expires_at) < new Date()) {
    return c.json({ error: 'This link has expired' }, 400)
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

  return c.redirect('/')
})
