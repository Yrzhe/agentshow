import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { DB_DIR, DB_FILE } from '@agentshow/shared'
import { initDaemonSchema } from './schema.js'

const dbInstances = new Map<string, Database.Database>()

function resolveDaemonDbPath(dbPath?: string): string {
  if (dbPath) {
    return resolve(dbPath)
  }

  return join(homedir(), DB_DIR, DB_FILE)
}

export function getDaemonDb(dbPath?: string): Database.Database {
  const resolvedPath = resolveDaemonDbPath(dbPath)
  const existingDb = dbInstances.get(resolvedPath)

  if (existingDb?.open) {
    return existingDb
  }

  if (existingDb && !existingDb.open) {
    dbInstances.delete(resolvedPath)
  }

  mkdirSync(dirname(resolvedPath), { recursive: true })

  const db = new Database(resolvedPath)
  db.pragma('journal_mode = WAL')
  initDaemonSchema(db)
  dbInstances.set(resolvedPath, db)
  return db
}
