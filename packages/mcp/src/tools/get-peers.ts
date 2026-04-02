import type Database from 'better-sqlite3'
import type {
  GetPeersAllOutput,
  GetPeersInput,
  GetPeersOutput,
  PeerInfo,
} from '@agentshow/shared'
import { SESSION_TIMEOUT_MS } from '@agentshow/shared'
import {
  getActiveSessionsByProject,
  getActiveSessionsSummary,
  markStaleSessionsInactive,
} from '../db/queries.js'
import type { ToolContext } from './register-status.js'
import { resolveProjectByName, resolveProjectNameById } from './project-utils.js'

export function handleGetPeers(
  input: GetPeersInput,
  ctx: ToolContext,
): GetPeersOutput | GetPeersAllOutput {
  markStaleSessionsInactive(ctx.db, SESSION_TIMEOUT_MS)

  if (input.scope === 'all') {
    return {
      projects: getActiveSessionsSummary(ctx.db).map((project) => ({
        project_id: project.project_id,
        name: project.project_name,
        active_sessions: project.active_sessions,
        notes_count: project.notes_count,
      })),
    }
  }

  let targetProjectId: string
  let targetProjectName: string

  if (input.project) {
    const resolvedProject = resolveProjectByName(ctx.db, input.project)

    if (!resolvedProject) {
      return {
        project: input.project,
        peers: [],
        notes_count: 0,
      }
    }

    targetProjectId = resolvedProject.id
    targetProjectName = resolvedProject.name
  } else {
    if (!ctx.projectId) {
      throw new Error('register_status must be called before get_peers')
    }

    targetProjectId = ctx.projectId
    targetProjectName = resolveProjectNameById(ctx.db, ctx.projectId)
  }

  const peers = getActiveSessionsByProject(
    ctx.db,
    targetProjectId,
    input.project ? undefined : ctx.sessionId ?? undefined,
  )

  return {
    project: targetProjectName,
    peers: peers.map((peer) => toPeerInfo(peer.files, peer)),
    notes_count: getNotesCount(ctx.db, targetProjectId),
  }
}

function getNotesCount(db: Database.Database, projectId: string): number {
  const row = db
    .prepare(
      `
        SELECT COUNT(*) AS count
        FROM notes
        WHERE project_id = ?
      `,
    )
    .get(projectId) as { count: number }

  return row.count
}

function toPeerInfo(files: string | null, peer: Omit<PeerInfo, 'files'>): PeerInfo {
  return {
    ...peer,
    files: parseFiles(files),
  }
}

function parseFiles(files: string | null): string[] {
  if (!files) {
    return []
  }

  try {
    const parsed = JSON.parse(files) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}
