import type {
  GetProjectHistoryInput,
  GetProjectHistoryOutput,
} from '@agentshow/shared'
import { getNotesByProject, getSessionHistory } from '../db/queries.js'
import type { ToolContext } from './register-status.js'
import { resolveProjectByName, resolveProjectNameById } from './project-utils.js'

export function handleGetProjectHistory(
  input: GetProjectHistoryInput,
  ctx: ToolContext,
): GetProjectHistoryOutput {
  const project = resolveRequestedProject(input.project, ctx)

  return {
    project: project.name,
    sessions: getSessionHistory(ctx.db, project.id, {
      since: input.since,
      search: input.search,
    }).map((session) => ({
      id: session.id,
      task: session.task,
      summary: session.summary,
      started_at: session.started_at,
      ended_at: session.ended_at,
    })),
    notes: getNotesByProject(ctx.db, project.id, {
      since: input.since,
      search: input.search,
    }).map((note) => ({
      id: note.id,
      key: note.key,
      content: note.content,
      session_id: note.session_id,
      created_at: note.created_at,
      updated_at: note.updated_at,
    })),
  }
}

function resolveRequestedProject(
  projectName: string | undefined,
  ctx: ToolContext,
): { id: string; name: string } {
  if (projectName) {
    const project = resolveProjectByName(ctx.db, projectName)

    if (!project) {
      return {
        id: '',
        name: projectName,
      }
    }

    return project
  }

  if (!ctx.projectId) {
    throw new Error('register_status must be called before get_project_history')
  }

  return {
    id: ctx.projectId,
    name: resolveProjectNameById(ctx.db, ctx.projectId),
  }
}
