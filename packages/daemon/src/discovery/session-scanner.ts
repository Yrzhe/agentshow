import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CLAUDE_SESSIONS_DIR, type ClaudeSessionMeta } from '@agentshow/shared'

function isSessionFile(fileName: string): boolean {
  return fileName.endsWith('.json') && !fileName.endsWith('.tmp.json')
}

function parseSessionFile(filePath: string): ClaudeSessionMeta | null {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as ClaudeSessionMeta
  } catch {
    return null
  }
}

export function scanSessions(claudeDir: string): ClaudeSessionMeta[] {
  const sessionsDir = join(claudeDir, CLAUDE_SESSIONS_DIR)

  if (!existsSync(sessionsDir)) {
    return []
  }

  return readdirSync(sessionsDir)
    .filter(isSessionFile)
    .map((fileName) => parseSessionFile(join(sessionsDir, fileName)))
    .filter((session): session is ClaudeSessionMeta => session !== null)
}
