import type Database from 'better-sqlite3'

export type ResolvedProject = {
  id: string
  name: string
}

export function resolveProjectByName(
  db: Database.Database,
  projectName: string,
): ResolvedProject | null {
  const fromSessions = db
    .prepare(
      `
        SELECT project_id AS id, project_name AS name
        FROM sessions
        WHERE project_name = ?
        ORDER BY started_at DESC
        LIMIT 1
      `,
    )
    .get(projectName) as ResolvedProject | undefined

  if (fromSessions) {
    return fromSessions
  }

  const fromHistory = db
    .prepare(
      `
        SELECT project_id AS id, project_name AS name
        FROM session_history
        WHERE project_name = ?
        ORDER BY ended_at DESC
        LIMIT 1
      `,
    )
    .get(projectName) as ResolvedProject | undefined

  return fromHistory ?? null
}

export function resolveProjectNameById(
  db: Database.Database,
  projectId: string,
): string {
  const fromSessions = db
    .prepare(
      `
        SELECT project_name
        FROM sessions
        WHERE project_id = ?
        ORDER BY started_at DESC
        LIMIT 1
      `,
    )
    .get(projectId) as { project_name: string } | undefined

  if (fromSessions) {
    return fromSessions.project_name
  }

  const fromHistory = db
    .prepare(
      `
        SELECT project_name
        FROM session_history
        WHERE project_id = ?
        ORDER BY ended_at DESC
        LIMIT 1
      `,
    )
    .get(projectId) as { project_name: string } | undefined

  return fromHistory?.project_name ?? projectId
}
