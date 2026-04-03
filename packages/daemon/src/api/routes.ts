import type Database from 'better-sqlite3'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { DaemonSession, DaemonSessionStatus } from '@agentshow/shared'
import {
  getAllDaemonSessions,
  getDaemonSessionsByStatus,
  getMcpNotesByProjectSlug,
  getMcpSessionByCwd,
  getSessionEvents,
  getSessionStats,
} from '../db/queries.js'

const LOCAL_HOST = '127.0.0.1'
const RECENT_EVENTS_LIMIT = 20

export function handleApiRequest(
  db: Database.Database,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  const url = new URL(req.url ?? '/', `http://${LOCAL_HOST}`)
  const { pathname } = url

  if (req.method !== 'GET') {
    sendJson(res, { error: 'Not Found' }, 404)
    return
  }

  if (pathname === '/health') {
    sendJson(res, { status: 'ok', uptime: process.uptime() })
    return
  }

  if (pathname === '/sessions') {
    const status = parseStatus(url.searchParams.get('status'))
    const sessions = status ? getDaemonSessionsByStatus(db, status) : getAllDaemonSessions(db)
    sendJson(res, { sessions })
    return
  }

  if (pathname === '/notes') {
    const notes = getMcpNotesByProjectSlug(db, url.searchParams.get('project_slug') ?? '')
    sendJson(res, { notes })
    return
  }

  const parts = pathname.split('/').filter((part) => part.length > 0)

  if (parts.length === 2 && parts[0] === 'sessions') {
    const sessionId = decodeURIComponent(parts[1] ?? '')
    const session = findSession(db, sessionId)
    const mcpSession = session ? getMcpSessionByCwd(db, session.cwd) : null
    const recent_events = getRecentEvents(db, sessionId)
    sendJson(res, {
      session: session
        ? {
          ...session,
          task: mcpSession?.task ?? null,
          files: mcpSession?.files ?? null,
        }
        : null,
      recent_events,
    })
    return
  }

  if (parts.length === 3 && parts[0] === 'sessions' && parts[2] === 'stats') {
    const session_id = decodeURIComponent(parts[1] ?? '')
    sendJson(res, { session_id, ...getSessionStats(db, session_id) })
    return
  }

  if (pathname === '/projects') {
    sendJson(res, { projects: getProjectSummaries(getAllDaemonSessions(db)) })
    return
  }

  sendJson(res, { error: 'Not Found' }, 404)
}

export function sendJson(res: ServerResponse, data: unknown, status = 200): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(data))
}

function parseStatus(status: string | null): DaemonSessionStatus | null {
  if (status === 'active' || status === 'discovered' || status === 'ended') {
    return status
  }

  return null
}

function findSession(db: Database.Database, sessionId: string): DaemonSession | null {
  return getAllDaemonSessions(db).find((session) => session.session_id === sessionId) ?? null
}

function getRecentEvents(db: Database.Database, sessionId: string) {
  return getSessionEvents(db, sessionId).slice(-RECENT_EVENTS_LIMIT)
}

function getProjectSummaries(sessions: DaemonSession[]) {
  const projects = new Map<string, {
    project_slug: string
    cwd: string
    active_sessions: number
    total_tokens: number
  }>()

  for (const session of sessions) {
    const current = projects.get(session.project_slug) ?? {
      project_slug: session.project_slug,
      cwd: session.cwd,
      active_sessions: 0,
      total_tokens: 0,
    }

    projects.set(session.project_slug, {
      ...current,
      active_sessions: current.active_sessions + (session.status === 'active' ? 1 : 0),
      total_tokens: current.total_tokens + session.total_input_tokens + session.total_output_tokens,
    })
  }

  return [...projects.values()].sort((left, right) =>
    left.project_slug.localeCompare(right.project_slug),
  )
}
