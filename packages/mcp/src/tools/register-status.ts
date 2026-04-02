import { homedir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import type {
  RegisterStatusInput,
  RegisterStatusOutput,
} from '@agentshow/shared'
import { generateSessionId, type SessionRecord } from '@agentshow/shared'
import { insertSession, updateSession } from '../db/queries.js'
import { detectProject } from '../project/detect.js'

export type ToolContext = {
  db: Database.Database
  sessionId: string | null
  projectId: string | null
}

type SessionIdentity = Pick<SessionRecord, 'project_id' | 'project_name'>

export function handleRegisterStatus(
  input: RegisterStatusInput,
  ctx: ToolContext,
): RegisterStatusOutput {
  if (!ctx.sessionId) {
    if (!input.cwd) {
      throw new Error('cwd is required on first register_status call')
    }

    const project = detectProject(input.cwd)
    const sessionId = generateSessionId()
    const conversationPath = getConversationPath(input.cwd, sessionId)

    insertSession(ctx.db, {
      id: sessionId,
      project_id: project.id,
      project_name: project.name,
      cwd: input.cwd,
      task: input.task ?? null,
      files: input.files ? JSON.stringify(input.files) : null,
      conversation_path: conversationPath,
      status: 'active',
    })

    return {
      session_id: sessionId,
      project_id: project.id,
      project_name: project.name,
      status: 'registered',
    }
  }

  const session = getSessionIdentity(ctx.db, ctx.sessionId)
  if (!session) {
    throw new Error(`Session not found: ${ctx.sessionId}`)
  }

  updateSession(ctx.db, ctx.sessionId, {
    task: input.task,
    files: input.files ? JSON.stringify(input.files) : input.files === undefined ? undefined : null,
    last_heartbeat: new Date().toISOString(),
  })

  return {
    session_id: ctx.sessionId,
    project_id: session.project_id,
    project_name: session.project_name,
    status: 'updated',
  }
}

function getConversationPath(cwd: string, sessionId: string): string {
  const projectSlug = cwd.replaceAll('/', '-')
  return join(homedir(), '.claude', 'projects', projectSlug, `${sessionId}.jsonl`)
}

function getSessionIdentity(
  db: Database.Database,
  sessionId: string,
): SessionIdentity | undefined {
  return db
    .prepare(
      `
        SELECT project_id, project_name
        FROM sessions
        WHERE id = ?
      `,
    )
    .get(sessionId) as SessionIdentity | undefined
}
