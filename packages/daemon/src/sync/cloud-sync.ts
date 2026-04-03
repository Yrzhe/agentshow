import type Database from 'better-sqlite3'
import {
  CLOUD_SYNC_INTERVAL_MS,
  SYNC_BATCH_SIZE,
  readConfig,
  shapeEventForSync,
  shapeSessionForSync,
  shouldSync,
  type MessageRecord,
  type SyncPayload,
} from '@agentshow/shared'
import {
  getEventsAfterLocalId,
  getSessionsModifiedSince,
  getSyncState,
  setSyncState,
} from '../db/queries.js'

const INITIAL_BACKOFF_MS = 30_000
const MAX_BACKOFF_MS = 300_000

export class CloudSync {
  private intervalId: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly db: Database.Database,
    private readonly configDir?: string,
  ) {}

  start(): void {
    if (this.intervalId) {
      return
    }

    this.intervalId = setInterval(() => {
      void this.tick().catch((error: unknown) => {
        console.error('cloud sync tick failed:', error)
      })
    }, CLOUD_SYNC_INTERVAL_MS)
  }

  stop(): void {
    if (!this.intervalId) {
      return
    }

    clearInterval(this.intervalId)
    this.intervalId = null
  }

  async tick(): Promise<void> {
    const config = readConfig(this.configDir)

    if (!shouldSync(config)) {
      return
    }

    const backoffUntil = getSyncState(this.db, 'backoff_until')
    if (backoffUntil && new Date(backoffUntil).getTime() > Date.now()) {
      return
    }

    const lastSyncedSessionAt = getSyncState(this.db, 'last_synced_session_at') ?? ''
    const lastSyncedEventId = Number(getSyncState(this.db, 'last_synced_event_id') ?? '0')
    const sessions = getSessionsModifiedSince(this.db, lastSyncedSessionAt)
      .map((session) => shapeSessionForSync(session, config.privacy.level))
    const rawEvents = config.privacy.level >= 2
      ? getEventsAfterLocalId(this.db, lastSyncedEventId, SYNC_BATCH_SIZE)
      : []
    const events = rawEvents
      .map((event) => shapeEventForSync(event, config.privacy.level))
      .filter((event): event is NonNullable<ReturnType<typeof shapeEventForSync>> => event !== null)
    const payload: SyncPayload = {
      device_id: config.device_id,
      synced_at: new Date().toISOString(),
      sessions,
      events,
    }

    try {
      const response = await fetch(`${config.cloud.url}/api/sync`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.cloud.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        throw new Error(`Sync failed with status ${response.status}`)
      }

      this.handleSuccess(sessions, rawEvents)
    } catch (error) {
      this.handleFailure(error)
    }
  }

  private handleSuccess(
    sessions: ReturnType<typeof getSessionsModifiedSince>,
    events: MessageRecord[],
  ): void {
    if (sessions.length > 0) {
      setSyncState(
        this.db,
        'last_synced_session_at',
        sessions[sessions.length - 1]?.last_seen_at ?? '',
      )
    }

    if (events.length > 0) {
      setSyncState(
        this.db,
        'last_synced_event_id',
        String(events[events.length - 1]?.id ?? 0),
      )
    }

    setSyncState(this.db, 'last_sync_error', '')
    setSyncState(this.db, 'backoff_until', '')
    setSyncState(this.db, 'backoff_ms', '0')
  }

  private handleFailure(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    const currentBackoff = this.getCurrentBackoffMs()
    const nextBackoff = currentBackoff > 0
      ? Math.min(currentBackoff * 2, MAX_BACKOFF_MS)
      : INITIAL_BACKOFF_MS

    setSyncState(this.db, 'last_sync_error', message)
    setSyncState(this.db, 'backoff_ms', String(nextBackoff))
    setSyncState(
      this.db,
      'backoff_until',
      new Date(Date.now() + nextBackoff).toISOString(),
    )
  }

  private getCurrentBackoffMs(): number {
    const rawBackoff = getSyncState(this.db, 'backoff_ms')
    const currentBackoff = Number(rawBackoff ?? '0')

    if (!Number.isFinite(currentBackoff) || currentBackoff <= 0) {
      return 0
    }

    return currentBackoff
  }
}
