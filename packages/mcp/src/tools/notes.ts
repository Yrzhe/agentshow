import type {
  DeleteNoteInput,
  DeleteNoteOutput,
  GetNotesInput,
  GetNotesOutput,
  ShareNoteInput,
  ShareNoteOutput,
} from '@agentshow/shared'
import {
  deleteNote,
  getNotesByProject,
  upsertNote,
} from '../db/queries.js'
import type { ToolContext } from './register-status.js'
import { resolveProjectByName, resolveProjectNameById } from './project-utils.js'

export function handleShareNote(
  input: ShareNoteInput,
  ctx: ToolContext,
): ShareNoteOutput {
  if (!ctx.projectId) {
    throw new Error('register_status must be called before share_note')
  }

  const result = upsertNote(
    ctx.db,
    ctx.projectId,
    ctx.sessionId,
    input.key,
    input.content,
  )

  return {
    id: result.id,
    key: input.key,
    status: result.status,
  }
}

export function handleGetNotes(
  input: GetNotesInput,
  ctx: ToolContext,
): GetNotesOutput {
  const project = resolveRequestedProject(input.project, ctx)

  return {
    project: project.name,
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

export function handleDeleteNote(
  input: DeleteNoteInput,
  ctx: ToolContext,
): DeleteNoteOutput {
  if (!ctx.projectId) {
    throw new Error('register_status must be called before delete_note')
  }

  return {
    status: deleteNote(ctx.db, ctx.projectId, input.key) ? 'deleted' : 'not_found',
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
    throw new Error('register_status must be called before get_notes')
  }

  return {
    id: ctx.projectId,
    name: resolveProjectNameById(ctx.db, ctx.projectId),
  }
}
