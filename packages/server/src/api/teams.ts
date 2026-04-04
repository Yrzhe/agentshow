import type Database from 'better-sqlite3'
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
import { generateId } from '../lib/id.js'
import { flexAuth, type ServerAppType } from '../middleware/auth.js'
import type { TeamMemberRole } from '../types.js'
import { estimateCost } from './usage.js'

export const teamRoutes = new Hono<ServerAppType>()
teamRoutes.use('*', flexAuth())

teamRoutes.get('/', async (c) => {
  const teams = getTeamsByUser(c.get('db'), c.get('userId'))
  return c.json({ teams })
})

teamRoutes.post('/', async (c) => {
  const body = await c.req.json<{ name?: string }>()
  const name = body.name?.trim()
  if (!name) return c.json({ error: 'Team name is required' }, 400)
  const team = createTeam(c.get('db'), generateId(), name, c.get('userId'))
  return c.json({ team }, 201)
})

teamRoutes.post('/invites/:inviteId/accept', async (c) => {
  const db = c.get('db')
  const inviteId = c.req.param('inviteId')
  const userId = c.get('userId')
  const user = getUserRecord(db, userId)
  if (!user?.email) return c.json({ error: 'Current user email not found' }, 400)
  const invite = getInviteByIdAndEmail(db, inviteId, user.email)
  if (!invite) return c.json({ error: 'Invite not found' }, 404)
  if (invite.status !== 'pending') return c.json({ error: 'Invite is no longer valid' }, 400)
  if (new Date(invite.expires_at).getTime() <= Date.now()) return c.json({ error: 'Invite has expired' }, 400)
  const accepted = acceptTeamInvite(db, inviteId, userId)
  return c.json({ invite: accepted })
})

teamRoutes.get('/:id', async (c) => {
  const access = getTeamAccess(c.get('db'), c.req.param('id'), c.get('userId'))
  if (access.error) return c.json({ error: access.error }, access.status)
  const members = getTeamMembers(c.get('db'), access.team.id)
  const recent_sessions = getTeamSessions(c.get('db'), access.team.id, {
    days: parseNumber(c.req.query('days'), 14, 365),
    limit: parseNumber(c.req.query('limit'), 20, 100),
    userId: access.isAdmin ? undefined : c.get('userId'),
  })
  const usage = withEstimatedCost(getTeamUsageSummary(c.get('db'), access.team.id, 30))
  const invites = access.isAdmin ? getTeamInvites(c.get('db'), access.team.id) : []
  return c.json({ team: access.team, members, invites, recent_sessions, usage, viewer_role: access.role, can_manage: access.isAdmin })
})

teamRoutes.put('/:id', async (c) => {
  const db = c.get('db')
  const team = getTeamById(db, c.req.param('id'))
  if (!team) return c.json({ error: 'Team not found' }, 404)
  if (team.owner_id !== c.get('userId')) return c.json({ error: 'Forbidden' }, 403)
  const body = await c.req.json<{ name?: string }>()
  const name = body.name?.trim()
  if (!name) return c.json({ error: 'Team name is required' }, 400)
  updateTeamName(db, team.id, c.get('userId'), name)
  return c.json({ team: getTeamById(db, team.id) })
})

teamRoutes.delete('/:id', async (c) => {
  const db = c.get('db')
  const team = getTeamById(db, c.req.param('id'))
  if (!team) return c.json({ error: 'Team not found' }, 404)
  if (team.owner_id !== c.get('userId')) return c.json({ error: 'Forbidden' }, 403)
  deleteTeam(db, team.id, c.get('userId'))
  return c.json({ status: 'deleted' })
})

teamRoutes.get('/:id/members', async (c) => {
  const access = getTeamAccess(c.get('db'), c.req.param('id'), c.get('userId'))
  if (access.error) return c.json({ error: access.error }, access.status)
  return c.json({ members: getTeamMembers(c.get('db'), access.team.id), viewer_role: access.role })
})

teamRoutes.post('/:id/members', async (c) => {
  const db = c.get('db')
  const access = getTeamAccess(db, c.req.param('id'), c.get('userId'))
  if (access.error) return c.json({ error: access.error }, access.status)
  if (!access.isAdmin) return c.json({ error: 'Forbidden' }, 403)
  const body = await c.req.json<{ email?: string }>()
  const email = body.email?.trim().toLowerCase()
  if (!email) return c.json({ error: 'Email is required' }, 400)
  const invitedUser = getUserByEmail(db, email)
  if (invitedUser && isTeamMember(db, access.team.id, invitedUser.id)) return c.json({ error: 'User is already a team member' }, 409)
  if (hasPendingInvite(db, access.team.id, email)) return c.json({ error: 'Invite already exists for this email' }, 409)
  const invite = createTeamInvite(db, generateId(), access.team.id, email, c.get('userId'), expiresInDays(7))
  return c.json({ invite }, 201)
})

teamRoutes.put('/:id/members/:userId', async (c) => {
  const db = c.get('db')
  const access = getTeamAccess(db, c.req.param('id'), c.get('userId'))
  if (access.error) return c.json({ error: access.error }, access.status)
  if (!access.isAdmin) return c.json({ error: 'Forbidden' }, 403)
  if (access.team.owner_id === c.req.param('userId')) return c.json({ error: 'Cannot change owner role' }, 400)
  const body = await c.req.json<{ role?: TeamMemberRole }>()
  if (body.role !== 'admin' && body.role !== 'member') return c.json({ error: 'Invalid role' }, 400)
  const updated = updateMemberRole(db, access.team.id, c.req.param('userId'), body.role)
  if (!updated) return c.json({ error: 'Member not found' }, 404)
  return c.json({ members: getTeamMembers(db, access.team.id) })
})

teamRoutes.delete('/:id/members/:userId', async (c) => {
  const db = c.get('db')
  const access = getTeamAccess(db, c.req.param('id'), c.get('userId'))
  if (access.error) return c.json({ error: access.error }, access.status)
  if (!access.isAdmin) return c.json({ error: 'Forbidden' }, 403)
  if (access.team.owner_id === c.req.param('userId')) return c.json({ error: 'Cannot remove the owner' }, 400)
  const removed = removeTeamMember(db, access.team.id, c.req.param('userId'))
  if (!removed) return c.json({ error: 'Member not found' }, 404)
  return c.json({ members: getTeamMembers(db, access.team.id) })
})

teamRoutes.get('/:id/invites', async (c) => {
  const access = getTeamAccess(c.get('db'), c.req.param('id'), c.get('userId'))
  if (access.error) return c.json({ error: access.error }, access.status)
  if (!access.isAdmin) return c.json({ error: 'Forbidden' }, 403)
  return c.json({ invites: getTeamInvites(c.get('db'), access.team.id) })
})

teamRoutes.get('/:id/sessions', async (c) => {
  const access = getTeamAccess(c.get('db'), c.req.param('id'), c.get('userId'))
  if (access.error) return c.json({ error: access.error }, access.status)
  const sessions = getTeamSessions(c.get('db'), access.team.id, {
    days: parseNumber(c.req.query('days'), 14, 365),
    limit: parseNumber(c.req.query('limit'), 50, 200),
    userId: access.isAdmin ? undefined : c.get('userId'),
  })
  return c.json({ sessions, viewer_role: access.role })
})

teamRoutes.get('/:id/usage', async (c) => {
  const access = getTeamAccess(c.get('db'), c.req.param('id'), c.get('userId'))
  if (access.error) return c.json({ error: access.error }, access.status)
  return c.json({ usage: withEstimatedCost(getTeamUsageSummary(c.get('db'), access.team.id, parseNumber(c.req.query('days'), 30, 365))) })
})

teamRoutes.get('/:id/report', async (c) => {
  const access = getTeamAccess(c.get('db'), c.req.param('id'), c.get('userId'))
  if (access.error) return c.json({ error: access.error }, access.status)
  if (!access.isAdmin) return c.json({ error: 'Forbidden' }, 403)
  const week_start = parseWeekStart(c.req.query('week'))
  const members = getTeamWeeklyReport(c.get('db'), access.team.id, week_start).map((member) => ({
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

function getTeamAccess(db: Database.Database, teamId: string, userId: string): TeamAccess {
  const team = getTeamById(db, teamId)
  if (!team) return { team: EMPTY_TEAM_REF, role: 'member', isAdmin: false, error: 'Team not found', status: 404 }
  if (!isTeamMember(db, teamId, userId)) return { team: EMPTY_TEAM_REF, role: 'member', isAdmin: false, error: 'Forbidden', status: 403 }
  const isAdmin = isTeamAdmin(db, teamId, userId) || team.owner_id === userId
  return { team, role: isAdmin ? 'admin' : 'member', isAdmin, error: null, status: 200 }
}

function getUserRecord(db: Database.Database, userId: string): UserRecord | null {
  const row = db.prepare('SELECT id, email, github_login FROM users WHERE id = ? LIMIT 1').get(userId) as UserRecord | undefined
  return row ?? null
}

function getUserByEmail(db: Database.Database, email: string): UserRecord | null {
  const row = db.prepare('SELECT id, email, github_login FROM users WHERE lower(email) = lower(?) LIMIT 1').get(email) as UserRecord | undefined
  return row ?? null
}

function hasPendingInvite(db: Database.Database, teamId: string, email: string): boolean {
  const row = db.prepare(`
    SELECT 1 FROM team_invites
    WHERE team_id = ? AND lower(email) = lower(?) AND status = 'pending'
    LIMIT 1
  `).get(teamId, email) as { 1: number } | undefined
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
