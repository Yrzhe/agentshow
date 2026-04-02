import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { DB_DIR, DB_FILE } from '@agentshow/shared'
import { initSchema } from './schema.js'

const dbInstances = new Map<string, Database.Database>()

function resolveDbPath(dbPath?: string): string {
  if (dbPath) {
    return resolve(dbPath)
  }

  return join(homedir(), DB_DIR, DB_FILE)
}

export function getDb(dbPath?: string): Database.Database {
  const resolvedPath = resolveDbPath(dbPath)
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
  initSchema(db)
  dbInstances.set(resolvedPath, db)

  return db
}
