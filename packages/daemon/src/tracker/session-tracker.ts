import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import {
  CLAUDE_PROJECTS_DIR,
  DAEMON_POLL_INTERVAL_MS,
  PID_CHECK_INTERVAL_MS,
  type ClaudeSessionMeta,
  type DaemonSession,
} from '@agentshow/shared'
import {
  getAllDaemonSessions,
  getFileOffset,
  getSessionStats,
  insertConversationEvents,
  setFileOffset,
  updateSessionStats,
  updateSessionStatus,
  upsertDaemonSession,
} from '../db/queries.js'
import { cwdToSlug } from '../discovery/slug.js'
import { isPidAlive } from '../discovery/pid-check.js'
import { scanSessions } from '../discovery/session-scanner.js'
import { extractEvents } from '../parser/event-extractor.js'
import { JsonlReader } from '../parser/jsonl-reader.js'

const PID_CHECK_TICK_INTERVAL = Math.max(
  1,
  Math.floor(PID_CHECK_INTERVAL_MS / DAEMON_POLL_INTERVAL_MS),
)

export class SessionTracker {
  private readonly reader = new JsonlReader()
  private intervalId: ReturnType<typeof setInterval> | null = null
  private tickCount = 0

  constructor(
    private readonly db: Database.Database,
    private readonly claudeDir: string,
  ) {}

  tick(): void {
    this.tickCount += 1

    const scannedSessions = scanSessions(this.claudeDir)
    const scannedSessionIds = new Set(scannedSessions.map((session) => session.sessionId))
    const existingSessions = getAllDaemonSessions(this.db)
    const sessionMap = new Map(existingSessions.map((session) => [session.session_id, session]))

    for (const sessionMeta of scannedSessions) {
      const projectSlug = cwdToSlug(sessionMeta.cwd)
      const conversationPath = this.getConversationPath(sessionMeta, projectSlug)
      const conversationExists = existsSync(conversationPath)
      const existingSession = sessionMap.get(sessionMeta.sessionId)

      if (!existingSession) {
        const daemonSession = this.createDaemonSession(
          sessionMeta,
          projectSlug,
          conversationExists ? conversationPath : null,
        )
        upsertDaemonSession(this.db, daemonSession)
        sessionMap.set(daemonSession.session_id, daemonSession)
      } else if (
        existingSession.cwd !== sessionMeta.cwd ||
        existingSession.project_slug !== projectSlug ||
        existingSession.pid !== sessionMeta.pid ||
        existingSession.conversation_path !== (conversationExists ? conversationPath : existingSession.conversation_path)
      ) {
        const syncedSession: DaemonSession = {
          ...existingSession,
          pid: sessionMeta.pid,
          cwd: sessionMeta.cwd,
          project_slug: projectSlug,
          conversation_path: conversationExists
            ? conversationPath
            : existingSession.conversation_path,
        }
        upsertDaemonSession(this.db, syncedSession)
        sessionMap.set(syncedSession.session_id, syncedSession)
      }

      if (conversationExists) {
        updateSessionStatus(this.db, sessionMeta.sessionId, 'active')
      }
    }

    const trackedSessions = getAllDaemonSessions(this.db).filter((session) =>
      session.status === 'active' || session.status === 'discovered'
    )
    const shouldCheckPid = this.tickCount % PID_CHECK_TICK_INTERVAL === 0

    for (const session of trackedSessions) {
      if (shouldCheckPid && !isPidAlive(session.pid)) {
        updateSessionStatus(this.db, session.session_id, 'ended')
        continue
      }

      if (!session.conversation_path || !existsSync(session.conversation_path)) {
        continue
      }

      this.reader.setOffset(session.conversation_path, getFileOffset(this.db, session.conversation_path))
      const { events, newOffset } = this.reader.readNewEvents(session.conversation_path)
      const extractedEvents = extractEvents(events).map((event) => ({
        ...event,
        session_id: session.session_id,
      }))

      if (extractedEvents.length > 0) {
        insertConversationEvents(this.db, extractedEvents)
        this.updateAggregatedStats(session.session_id, extractedEvents.length, extractedEvents)
      }

      this.reader.setOffset(session.conversation_path, newOffset)
      setFileOffset(this.db, session.conversation_path, newOffset)
    }

    for (const session of trackedSessions) {
      if (!scannedSessionIds.has(session.session_id)) {
        updateSessionStatus(this.db, session.session_id, 'ended')
      }
    }
  }

  start(): void {
    if (this.intervalId) {
      return
    }

    this.intervalId = setInterval(() => {
      this.tick()
    }, DAEMON_POLL_INTERVAL_MS)
  }

  stop(): void {
    if (!this.intervalId) {
      return
    }

    clearInterval(this.intervalId)
    this.intervalId = null
  }

  private getConversationPath(sessionMeta: ClaudeSessionMeta, slug: string): string {
    return join(this.claudeDir, CLAUDE_PROJECTS_DIR, slug, `${sessionMeta.sessionId}.jsonl`)
  }

  private createDaemonSession(
    sessionMeta: ClaudeSessionMeta,
    projectSlug: string,
    conversationPath: string | null,
  ): DaemonSession {
    const startedAt = new Date(sessionMeta.startedAt).toISOString()

    return {
      session_id: sessionMeta.sessionId,
      pid: sessionMeta.pid,
      cwd: sessionMeta.cwd,
      project_slug: projectSlug,
      status: 'discovered',
      started_at: startedAt,
      last_seen_at: startedAt,
      conversation_path: conversationPath,
      message_count: 0,
      total_input_tokens: 0,
      total_output_tokens: 0,
      tool_calls: 0,
    }
  }

  private updateAggregatedStats(
    sessionId: string,
    messageCountDelta: number,
    events: ReturnType<typeof extractEvents>,
  ): void {
    const currentStats = getSessionStats(this.db, sessionId)
    const totals = events.reduce(
      (acc, event) => ({
        input_tokens: acc.input_tokens + event.input_tokens,
        output_tokens: acc.output_tokens + event.output_tokens,
        tool_calls: acc.tool_calls + (event.tool_name ? event.tool_name.split(',').length : 0),
      }),
      { input_tokens: 0, output_tokens: 0, tool_calls: 0 },
    )

    updateSessionStats(this.db, sessionId, {
      message_count: currentStats.message_count + messageCountDelta,
      total_input_tokens: currentStats.total_input_tokens + totals.input_tokens,
      total_output_tokens: currentStats.total_output_tokens + totals.output_tokens,
      tool_calls: currentStats.tool_calls + totals.tool_calls,
    })
  }
}
