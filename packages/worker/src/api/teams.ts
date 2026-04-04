import { Hono } from 'hono'
import {
  acceptTeamInvite,
  createTeam,
  createTeamInvite,
  deleteTeam,
  getInviteByIdAndEmail,
  getTeamById,
  getTeamInvites,
  getTeamMembers,
  getTeamSessions,
  getTeamsByUser,
  getTeamUsageSummary,
  getTeamWeeklyReport,
  isTeamAdmin,
  isTeamMember,
  removeTeamMember,
  updateMemberRole,
  updateTeamName,
} from '../db/queries.js'
import type { AppType } from '../index.js'
import { generateId } from '../lib/id.js'
import { flexAuth } from '../middleware/auth.js'
import type { TeamMemberRole } from '../types.js'
import { estimateCost } from './usage.js'

export const teamRoutes = new Hono<AppType>()
teamRoutes.use('*', flexAuth())

teamRoutes.get('/', async (c) => {
  const teams = await getTeamsByUser(c.env.DB, c.get('userId'))
  return c.json({ teams })
})

teamRoutes.post('/', async (c) => {
  const body = await c.req.json<{ name?: string }>()
  const name = body.name?.trim()
  if (!name) return c.json({ error: 'Team name is required' }, 400)
  const team = await createTeam(c.env.DB, generateId(), name, c.get('userId'))
  return c.json({ team }, 201)
})

teamRoutes.post('/invites/:inviteId/accept', async (c) => {
  const inviteId = c.req.param('inviteId')
  const userId = c.get('userId')
  const user = await getUserRecord(c.env.DB, userId)
  if (!user?.email) return c.json({ error: 'Current user email not found' }, 400)
  const invite = await getInviteByIdAndEmail(c.env.DB, inviteId, user.email)
  if (!invite) return c.json({ error: 'Invite not found' }, 404)
  if (invite.status !== 'pending') return c.json({ error: 'Invite is no longer valid' }, 400)
  if (new Date(invite.expires_at).getTime() <= Date.now()) return c.json({ error: 'Invite has expired' }, 400)
  const accepted = await acceptTeamInvite(c.env.DB, inviteId, userId)
  return c.json({ invite: accepted })
})

teamRoutes.get('/:id', async (c) => {
  const access = await getTeamAccess(c.env.DB, c.req.param('id'), c.get('userId'))
  if (access.error) return c.json({ error: access.error }, access.status)
  const members = await getTeamMembers(c.env.DB, access.team.id)
  const recent_sessions = await getTeamSessions(c.env.DB, access.team.id, {
    days: parseNumber(c.req.query('days'), 14, 365),
    limit: parseNumber(c.req.query('limit'), 20, 100),
    userId: access.isAdmin ? undefined : c.get('userId'),
  })
  const usage = withEstimatedCost(await getTeamUsageSummary(c.env.DB, access.team.id, 30))
  const invites = access.isAdmin ? await getTeamInvites(c.env.DB, access.team.id) : []
  return c.json({ team: access.team, members, invites, recent_sessions, usage, viewer_role: access.role, can_manage: access.isAdmin })
})

teamRoutes.put('/:id', async (c) => {
  const team = await getTeamById(c.env.DB, c.req.param('id'))
  if (!team) return c.json({ error: 'Team not found' }, 404)
  if (team.owner_id !== c.get('userId')) return c.json({ error: 'Forbidden' }, 403)
  const body = await c.req.json<{ name?: string }>()
  const name = body.name?.trim()
  if (!name) return c.json({ error: 'Team name is required' }, 400)
  await updateTeamName(c.env.DB, team.id, c.get('userId'), name)
  return c.json({ team: await getTeamById(c.env.DB, team.id) })
})

teamRoutes.delete('/:id', async (c) => {
  const team = await getTeamById(c.env.DB, c.req.param('id'))
  if (!team) return c.json({ error: 'Team not found' }, 404)
  if (team.owner_id !== c.get('userId')) return c.json({ error: 'Forbidden' }, 403)
  await deleteTeam(c.env.DB, team.id, c.get('userId'))
  return c.json({ status: 'deleted' })
})

teamRoutes.get('/:id/members', async (c) => {
  const access = await getTeamAccess(c.env.DB, c.req.param('id'), c.get('userId'))
  if (access.error) return c.json({ error: access.error }, access.status)
  return c.json({ members: await getTeamMembers(c.env.DB, access.team.id), viewer_role: access.role })
})

teamRoutes.post('/:id/members', async (c) => {
  const access = await getTeamAccess(c.env.DB, c.req.param('id'), c.get('userId'))
  if (access.error) return c.json({ error: access.error }, access.status)
  if (!access.isAdmin) return c.json({ error: 'Forbidden' }, 403)
  const body = await c.req.json<{ email?: string }>()
  const email = body.email?.trim().toLowerCase()
  if (!email) return c.json({ error: 'Email is required' }, 400)
  const invitedUser = await getUserByEmail(c.env.DB, email)
  if (invitedUser && await isTeamMember(c.env.DB, access.team.id, invitedUser.id)) return c.json({ error: 'User is already a team member' }, 409)
  if (await hasPendingInvite(c.env.DB, access.team.id, email)) return c.json({ error: 'Invite already exists for this email' }, 409)
  const invite = await createTeamInvite(c.env.DB, generateId(), access.team.id, email, c.get('userId'), expiresInDays(7))
  return c.json({ invite }, 201)
})

teamRoutes.put('/:id/members/:userId', async (c) => {
  const access = await getTeamAccess(c.env.DB, c.req.param('id'), c.get('userId'))
  if (access.error) return c.json({ error: access.error }, access.status)
  if (!access.isAdmin) return c.json({ error: 'Forbidden' }, 403)
  if (access.team.owner_id === c.req.param('userId')) return c.json({ error: 'Cannot change owner role' }, 400)
  const body = await c.req.json<{ role?: TeamMemberRole }>()
  if (body.role !== 'admin' && body.role !== 'member') return c.json({ error: 'Invalid role' }, 400)
  const updated = await updateMemberRole(c.env.DB, access.team.id, c.req.param('userId'), body.role)
  if (!updated) return c.json({ error: 'Member not found' }, 404)
  return c.json({ members: await getTeamMembers(c.env.DB, access.team.id) })
})

teamRoutes.delete('/:id/members/:userId', async (c) => {
  const access = await getTeamAccess(c.env.DB, c.req.param('id'), c.get('userId'))
  if (access.error) return c.json({ error: access.error }, access.status)
  if (!access.isAdmin) return c.json({ error: 'Forbidden' }, 403)
  if (access.team.owner_id === c.req.param('userId')) return c.json({ error: 'Cannot remove the owner' }, 400)
  const removed = await removeTeamMember(c.env.DB, access.team.id, c.req.param('userId'))
  if (!removed) return c.json({ error: 'Member not found' }, 404)
  return c.json({ members: await getTeamMembers(c.env.DB, access.team.id) })
})

teamRoutes.get('/:id/invites', async (c) => {
  const access = await getTeamAccess(c.env.DB, c.req.param('id'), c.get('userId'))
  if (access.error) return c.json({ error: access.error }, access.status)
  if (!access.isAdmin) return c.json({ error: 'Forbidden' }, 403)
  return c.json({ invites: await getTeamInvites(c.env.DB, access.team.id) })
})

teamRoutes.get('/:id/sessions', async (c) => {
  const access = await getTeamAccess(c.env.DB, c.req.param('id'), c.get('userId'))
  if (access.error) return c.json({ error: access.error }, access.status)
  const sessions = await getTeamSessions(c.env.DB, access.team.id, {
    days: parseNumber(c.req.query('days'), 14, 365),
    limit: parseNumber(c.req.query('limit'), 50, 200),
    userId: access.isAdmin ? undefined : c.get('userId'),
  })
  return c.json({ sessions, viewer_role: access.role })
})

teamRoutes.get('/:id/usage', async (c) => {
  const access = await getTeamAccess(c.env.DB, c.req.param('id'), c.get('userId'))
  if (access.error) return c.json({ error: access.error }, access.status)
  return c.json({ usage: withEstimatedCost(await getTeamUsageSummary(c.env.DB, access.team.id, parseNumber(c.req.query('days'), 30, 365))) })
})

teamRoutes.get('/:id/report', async (c) => {
  const access = await getTeamAccess(c.env.DB, c.req.param('id'), c.get('userId'))
  if (access.error) return c.json({ error: access.error }, access.status)
  if (!access.isAdmin) return c.json({ error: 'Forbidden' }, 403)
  const week_start = parseWeekStart(c.req.query('week'))
  const members = (await getTeamWeeklyReport(c.env.DB, access.team.id, week_start)).map((member) => ({
    ...member,
    estimated_cost: roundCost(estimateCost(member.input_tokens, member.output_tokens)),
  }))
  const totals = members.reduce((acc, member) => ({
    session_count: acc.session_count + Number(member.session_count ?? 0),
    input_tokens: acc.input_tokens + Number(member.input_tokens ?? 0),
    output_tokens: acc.output_tokens + Number(member.output_tokens ?? 0),
    tool_calls: acc.tool_calls + Number(member.tool_calls ?? 0),
    estimated_cost: roundCost(acc.estimated_cost + Number(member.estimated_cost ?? 0)),
  }), { session_count: 0, input_tokens: 0, output_tokens: 0, tool_calls: 0, estimated_cost: 0 })
  return c.json({ team_id: access.team.id, week_start, members, totals })
})

async function getTeamAccess(db: D1Database, teamId: string, userId: string): Promise<TeamAccess> {
  const team = await getTeamById(db, teamId)
  if (!team) return { team: EMPTY_TEAM_REF, role: 'member', isAdmin: false, error: 'Team not found', status: 404 }
  if (!await isTeamMember(db, teamId, userId)) return { team: EMPTY_TEAM_REF, role: 'member', isAdmin: false, error: 'Forbidden', status: 403 }
  const isAdmin = await isTeamAdmin(db, teamId, userId) || team.owner_id === userId
  return { team, role: isAdmin ? 'admin' : 'member', isAdmin, error: null, status: 200 }
}

async function getUserRecord(db: D1Database, userId: string): Promise<UserRecord | null> {
  const row = await db.prepare('SELECT id, email, github_login FROM users WHERE id = ? LIMIT 1').bind(userId).first<UserRecord>()
  return row ?? null
}

async function getUserByEmail(db: D1Database, email: string): Promise<UserRecord | null> {
  const row = await db.prepare('SELECT id, email, github_login FROM users WHERE lower(email) = lower(?) LIMIT 1').bind(email).first<UserRecord>()
  return row ?? null
}

async function hasPendingInvite(db: D1Database, teamId: string, email: string): Promise<boolean> {
  const row = await db.prepare(`
    SELECT 1 FROM team_invites
    WHERE team_id = ? AND lower(email) = lower(?) AND status = 'pending'
    LIMIT 1
  `).bind(teamId, email).first<{ 1: number }>()
  return Boolean(row)
}

function withEstimatedCost(summary: { input_tokens: number; output_tokens: number }) {
  return { ...summary, estimated_cost: roundCost(estimateCost(summary.input_tokens, summary.output_tokens)) }
}

function expiresInDays(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
}

function parseNumber(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(parsed, max)
}

function parseWeekStart(value: string | undefined): string {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const now = new Date()
  const day = (now.getUTCDay() + 6) % 7
  now.setUTCDate(now.getUTCDate() - day)
  return now.toISOString().slice(0, 10)
}

function roundCost(value: number): number {
  return Math.round(value * 10000) / 10000
}

const EMPTY_TEAM_REF = { id: '', owner_id: '' }

type TeamAccess = {
  team: { id: string; owner_id: string }
  role: TeamMemberRole
  isAdmin: boolean
  error: string | null
  status: 200 | 403 | 404
}

type UserRecord = { id: string; email: string | null; github_login: string | null }
