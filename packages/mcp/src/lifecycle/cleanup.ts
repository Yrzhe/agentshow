import type Database from 'better-sqlite3'
import {
  insertSessionHistory,
  markInactive,
} from '../db/queries.js'

type ProjectInfo = {
  id: string
  name: string
}

export function registerCleanupHooks(
  db: Database.Database,
  getSessionId: () => string | null,
  getProjectInfo: () => ProjectInfo | null,
): void {
  let cleanedUp = false

  const cleanup = (): void => {
    if (cleanedUp) {
      return
    }

    cleanedUp = true

    const sessionId = getSessionId()
    const projectInfo = getProjectInfo()

    if (sessionId && projectInfo) {
      const session = db
        .prepare(
          `
            SELECT task, conversation_path, started_at
            FROM sessions
            WHERE id = ?
          `,
        )
        .get(sessionId) as
        | {
            task: string | null
            conversation_path: string | null
            started_at: string
          }
        | undefined

      if (session) {
        markInactive(db, sessionId)

        const existingHistory = db
          .prepare(
            `
              SELECT id
              FROM session_history
              WHERE id = ?
            `,
          )
          .get(sessionId) as { id: string } | undefined

        if (!existingHistory) {
          insertSessionHistory(db, {
            id: sessionId,
            project_id: projectInfo.id,
            project_name: projectInfo.name,
            task: session.task,
            summary: null,
            conversation_path: session.conversation_path,
            started_at: session.started_at,
          })
        }
      }
    }

    if (db.open) {
      db.close()
    }
  }

  process.on('exit', cleanup)
  process.on('SIGINT', () => {
    cleanup()
    process.exit(0)
  })
  process.on('SIGTERM', () => {
    cleanup()
    process.exit(0)
  })
}
