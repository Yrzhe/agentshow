import type Database from 'better-sqlite3'
import type {
  AuditLog,
  AuditStat,
  CloudNote,
  CloudProject,
  CloudSession,
  CloudSessionStatus,
  SearchResult,
  Team,
  TeamInvite,
  TeamListItem,
  TeamMember,
  TeamMemberRole,
  TeamSession,
  TeamUsageSummary,
  TeamWeeklyReportMember,
  Workflow,
  WorkflowRun,
  WorkflowRunStatus,
  SyncEvent,
  SyncNote,
  SyncSession,
} from '../types.js'

type SessionQueryOptions = {
  status?: CloudSessionStatus
  project_slug?: string
  limit?: number
  offset?: number
}

type EventQueryOptions = { limit?: number }

type Watermark = {
  last_session_seen_at: string | null
  last_event_local_id: number
}

type SessionStats = Pick<
  CloudSession,
  'total_input_tokens' | 'total_output_tokens' | 'tool_calls' | 'message_count'
>

type BudgetType = 'daily' | 'monthly'

type BudgetSetting = {
  budget_type: BudgetType
  limit_usd: number
  alert_threshold: number
}

type WebhookConfigInput = {
  name: string
  url: string
  secret?: string | null
  events: string
}

type WebhookConfigUpdate = WebhookConfigInput & {
  is_active: number
}

type WebhookConfigRow = {
  id: number
  user_id: string
  name: string
  url: string
  secret: string | null
  events: string
  is_active: number
  created_at: string
  updated_at: string
}

type WebhookDeliveryInput = {
  webhook_id: number
  event_type: string
  payload: string
  status_code: number | null
  response_body: string
  success: number
}

type WebhookDeliveryRow = {
  id: number
  webhook_id: number
  event_type: string
  payload: string
  status_code: number | null
  response_body: string | null
  success: number
  attempted_at: string
}

type AuditLogInput = {
  session_id: string
  project_slug?: string | null
  action_type: AuditLog['action_type']
  action_detail?: string | null
  file_path?: string | null
  metadata?: string | null
}

type WorkflowInput = {
  id: string
  name: string
  trigger_type: string
  trigger_filter?: string | null
  action_type: Workflow['action_type']
  action_config: string
  is_active?: number
}

type WorkflowUpdate = Omit<WorkflowInput, 'id'>

export function upsertCloudSession(
  db: Database.Database,
  userId: string,
  session: SyncSession,
  deviceId: string,
): void {
  db.prepare(
    `
      INSERT OR REPLACE INTO cloud_sessions (
        session_id, user_id, device_id, pid, cwd, project_slug, status,
        started_at, last_seen_at, message_count, total_input_tokens,
        total_output_tokens, tool_calls, task, files, synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `,
  ).run(
    session.session_id,
    userId,
    deviceId,
    session.pid,
    session.cwd,
    session.project_slug,
    session.status,
    session.started_at,
    session.last_seen_at,
    session.message_count,
    session.total_input_tokens,
    session.total_output_tokens,
    session.tool_calls,
    session.task ?? null,
    session.files ?? null,
  )
}

export function getCloudSessions(
  db: Database.Database,
  userId: string,
  opts: SessionQueryOptions = {},
): CloudSession[] {
  const conditions = ['user_id = ?']
  const values: Array<string | number> = [userId]

  if (opts.status) {
    conditions.push('status = ?')
    values.push(opts.status)
  }
  if (opts.project_slug) {
    conditions.push('project_slug = ?')
    values.push(opts.project_slug)
  }

  return db.prepare(
    `
      SELECT *
      FROM cloud_sessions
      WHERE ${conditions.join(' AND ')}
      ORDER BY last_seen_at DESC, session_id ASC
      LIMIT ? OFFSET ?
    `,
  ).all(...values, opts.limit ?? 100, opts.offset ?? 0) as CloudSession[]
}

export function getCloudSession(
  db: Database.Database,
  userId: string,
  sessionId: string,
): CloudSession | null {
  const row = db.prepare(
    'SELECT * FROM cloud_sessions WHERE user_id = ? AND session_id = ? LIMIT 1',
  ).get(userId, sessionId) as CloudSession | undefined

  return row ?? null
}

export function getCloudSessionStats(
  db: Database.Database,
  userId: string,
  sessionId: string,
): SessionStats {
  const row = db.prepare(
    `
      SELECT total_input_tokens, total_output_tokens, tool_calls, message_count
      FROM cloud_sessions
      WHERE user_id = ? AND session_id = ?
      LIMIT 1
    `,
  ).get(userId, sessionId) as SessionStats | undefined

  return row ?? {
    total_input_tokens: 0,
    total_output_tokens: 0,
    tool_calls: 0,
    message_count: 0,
  }
}

export function updateSessionSummary(
  db: Database.Database,
  userId: string,
  sessionId: string,
  summary: string,
): void {
  db.prepare(
    'UPDATE cloud_sessions SET summary = ? WHERE session_id = ? AND user_id = ?',
  ).run(summary, sessionId, userId)
}

export function insertCloudEvents(
  db: Database.Database,
  userId: string,
  events: SyncEvent[],
): void {
  if (events.length === 0) {
    return
  }

  const insert = db.prepare(
    `
      INSERT INTO cloud_events (
        user_id, session_id, local_id, type, role, content_preview,
        tool_name, input_tokens, output_tokens, model, timestamp, synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `,
  )

  db.transaction((rows: SyncEvent[]) => {
    for (const event of rows) {
      insert.run(
        userId,
        event.session_id,
        event.local_id,
        event.type,
        event.role,
        event.content_preview ?? null,
        event.tool_name,
        event.input_tokens,
        event.output_tokens,
        event.model,
        event.timestamp,
      )
    }
  })(events)
}

export function getCloudEvents(
  db: Database.Database,
  userId: string,
  sessionId: string,
  opts: EventQueryOptions = {},
): SyncEvent[] {
  const results = db.prepare(
    `
      SELECT local_id, session_id, type, role, content_preview, tool_name,
             input_tokens, output_tokens, model, timestamp
      FROM cloud_events
      WHERE user_id = ? AND session_id = ?
        AND type IN ('user', 'assistant', 'system')
      ORDER BY local_id DESC
      LIMIT ?
    `,
  ).all(userId, sessionId, opts.limit ?? 100) as SyncEvent[]

  return results.reverse()
}

export function getCloudProjects(db: Database.Database, userId: string): CloudProject[] {
  return db.prepare(
    `
      SELECT
        project_slug,
        MIN(cwd) AS cwd,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_sessions,
        COUNT(*) AS total_sessions,
        SUM(total_input_tokens) AS total_input_tokens,
        SUM(total_output_tokens) AS total_output_tokens,
        SUM(tool_calls) AS total_tool_calls,
        MAX(last_seen_at) AS last_activity
      FROM cloud_sessions
      WHERE user_id = ?
      GROUP BY project_slug
      ORDER BY last_activity DESC, project_slug ASC
    `,
  ).all(userId) as CloudProject[]
}

export function getWatermark(
  db: Database.Database,
  userId: string,
  deviceId: string,
): Watermark {
  const row = db.prepare(
    `
      SELECT last_session_seen_at, last_event_local_id
      FROM sync_watermarks
      WHERE user_id = ? AND device_id = ?
      LIMIT 1
    `,
  ).get(userId, deviceId) as Watermark | undefined

  return row ?? { last_session_seen_at: null, last_event_local_id: 0 }
}

export function updateWatermark(
  db: Database.Database,
  userId: string,
  deviceId: string,
  sessionSeenAt: string | null,
  eventLocalId: number,
): void {
  db.prepare(
    `
      INSERT OR REPLACE INTO sync_watermarks (
        user_id, device_id, last_session_seen_at, last_event_local_id, updated_at
      ) VALUES (?, ?, ?, ?, datetime('now'))
    `,
  ).run(userId, deviceId, sessionSeenAt, eventLocalId)
}

export function searchCloudEvents(
  db: Database.Database,
  userId: string,
  query: string,
  opts: { limit: number; offset: number },
): { results: SearchResult[]; total: number } {
  const countRow = db.prepare(
    `
      SELECT (
        (SELECT COUNT(*) FROM cloud_events e
         JOIN cloud_sessions s ON s.session_id = e.session_id AND s.user_id = e.user_id
         WHERE e.user_id = ?
           AND (
             e.content_preview LIKE '%' || ? || '%'
             OR e.tool_name LIKE '%' || ? || '%'
             OR s.cwd LIKE '%' || ? || '%'
             OR s.project_slug LIKE '%' || ? || '%'
           ))
        +
        (SELECT COUNT(*) FROM cloud_notes
         WHERE user_id = ?
           AND (key LIKE '%' || ? || '%' OR content LIKE '%' || ? || '%'))
      ) AS total
    `,
  ).get(userId, query, query, query, query, userId, query, query) as { total: number } | undefined

  const results = db.prepare(
    `
      SELECT * FROM (
        SELECT
          e.local_id,
          e.session_id,
          e.type,
          e.role,
          e.content_preview,
          e.tool_name,
          e.model,
          e.timestamp,
          e.input_tokens,
          e.output_tokens,
          s.cwd,
          s.project_slug,
          s.status AS session_status,
          'event' AS source_type
        FROM cloud_events e
        JOIN cloud_sessions s ON s.session_id = e.session_id AND s.user_id = e.user_id
        WHERE e.user_id = ?
          AND (
            e.content_preview LIKE '%' || ? || '%'
            OR e.tool_name LIKE '%' || ? || '%'
            OR s.cwd LIKE '%' || ? || '%'
            OR s.project_slug LIKE '%' || ? || '%'
          )

        UNION ALL

        SELECT
          n.id AS local_id,
          COALESCE(n.session_id, '') AS session_id,
          'note' AS type,
          NULL AS role,
          n.content AS content_preview,
          n.key AS tool_name,
          NULL AS model,
          n.updated_at AS timestamp,
          0 AS input_tokens,
          0 AS output_tokens,
          '' AS cwd,
          COALESCE(n.project_slug, n.project_id) AS project_slug,
          '' AS session_status,
          'note' AS source_type
        FROM cloud_notes n
        WHERE n.user_id = ?
          AND (n.key LIKE '%' || ? || '%' OR n.content LIKE '%' || ? || '%')
      )
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `,
  ).all(
    userId, query, query, query, query,
    userId, query, query,
    opts.limit, opts.offset,
  ) as SearchResult[]

  return {
    results,
    total: Number(countRow?.total ?? 0),
  }
}

export function upsertCloudNote(
  db: Database.Database,
  userId: string,
  deviceId: string,
  note: SyncNote,
  projectSlug: string | null,
): void {
  db.prepare(`
    INSERT OR REPLACE INTO cloud_notes (
      user_id, device_id, project_id, project_slug, key, content,
      session_id, created_at, updated_at, synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    userId,
    deviceId,
    note.project_id,
    projectSlug,
    note.key,
    note.content,
    note.session_id,
    note.created_at,
    note.updated_at,
  )
}

export function getCloudNotes(
  db: Database.Database,
  userId: string,
  opts: { project_slug?: string | null | undefined; session_id?: string | null | undefined; limit?: number },
): CloudNote[] {
  const conditions = ['user_id = ?']
  const values: Array<string | number> = [userId]

  if (opts.project_slug) {
    conditions.push('project_slug = ?')
    values.push(opts.project_slug)
  }
  if (opts.session_id) {
    conditions.push('session_id = ?')
    values.push(opts.session_id)
  }

  return db.prepare(`
    SELECT * FROM cloud_notes WHERE ${conditions.join(' AND ')}
    ORDER BY updated_at DESC LIMIT ?
  `).all(...values, opts.limit ?? 50) as CloudNote[]
}

export function getTokensByDay(
  db: Database.Database,
  userId: string,
  days: number = 14,
): Array<{ date: string; input_tokens: number; output_tokens: number }> {
  return db.prepare(`
    SELECT
      date(started_at) AS date,
      SUM(total_input_tokens) AS input_tokens,
      SUM(total_output_tokens) AS output_tokens
    FROM cloud_sessions
    WHERE user_id = ? AND started_at >= datetime('now', '-' || ? || ' days')
    GROUP BY date(started_at)
    ORDER BY date ASC
  `).all(userId, days) as Array<{ date: string; input_tokens: number; output_tokens: number }>
}

export function getBudgetSettings(
  db: Database.Database,
  userId: string,
): BudgetSetting[] {
  return db.prepare(`
    SELECT budget_type, limit_usd, alert_threshold
    FROM budget_settings
    WHERE user_id = ?
    ORDER BY CASE budget_type WHEN 'daily' THEN 0 ELSE 1 END
  `).all(userId) as BudgetSetting[]
}

export function upsertBudgetSetting(
  db: Database.Database,
  userId: string,
  budgetType: BudgetType,
  limitUsd: number,
  alertThreshold: number,
): void {
  db.prepare(`
    INSERT INTO budget_settings (user_id, budget_type, limit_usd, alert_threshold, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, budget_type) DO UPDATE SET
      limit_usd = excluded.limit_usd,
      alert_threshold = excluded.alert_threshold,
      updated_at = datetime('now')
  `).run(userId, budgetType, limitUsd, alertThreshold)
}

export function deleteBudgetSetting(
  db: Database.Database,
  userId: string,
  budgetType: BudgetType,
): void {
  db.prepare('DELETE FROM budget_settings WHERE user_id = ? AND budget_type = ?').run(userId, budgetType)
}

export function getWebhookConfigs(
  db: Database.Database,
  userId: string,
): WebhookConfigRow[] {
  return db.prepare(`
    SELECT *
    FROM webhook_configs
    WHERE user_id = ?
    ORDER BY created_at DESC, id DESC
  `).all(userId) as WebhookConfigRow[]
}

export function getWebhookConfigById(
  db: Database.Database,
  userId: string,
  webhookId: number,
): WebhookConfigRow | null {
  const row = db.prepare(`
    SELECT *
    FROM webhook_configs
    WHERE user_id = ? AND id = ?
    LIMIT 1
  `).get(userId, webhookId) as WebhookConfigRow | undefined
  return row ?? null
}

export function createWebhookConfig(
  db: Database.Database,
  userId: string,
  input: WebhookConfigInput,
): number {
  const result = db.prepare(`
    INSERT INTO webhook_configs (user_id, name, url, secret, events, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `).run(userId, input.name, input.url, input.secret ?? null, input.events)
  return Number(result.lastInsertRowid)
}

export function updateWebhookConfig(
  db: Database.Database,
  userId: string,
  webhookId: number,
  input: WebhookConfigUpdate,
): void {
  db.prepare(`
    UPDATE webhook_configs
    SET name = ?, url = ?, secret = ?, events = ?, is_active = ?, updated_at = datetime('now')
    WHERE user_id = ? AND id = ?
  `).run(
    input.name,
    input.url,
    input.secret ?? null,
    input.events,
    input.is_active,
    userId,
    webhookId,
  )
}

export function deleteWebhookConfig(
  db: Database.Database,
  userId: string,
  webhookId: number,
): void {
  db.prepare('DELETE FROM webhook_configs WHERE user_id = ? AND id = ?').run(userId, webhookId)
}

export function getActiveWebhooksForEvent(
  db: Database.Database,
  userId: string,
  eventType: string,
): WebhookConfigRow[] {
  return db.prepare(`
    SELECT *
    FROM webhook_configs
    WHERE user_id = ?
      AND is_active = 1
      AND instr(',' || replace(events, ' ', '') || ',', ',' || ? || ',') > 0
    ORDER BY id ASC
  `).all(userId, eventType) as WebhookConfigRow[]
}

export function insertWebhookDelivery(
  db: Database.Database,
  input: WebhookDeliveryInput,
): number {
  const result = db.prepare(`
    INSERT INTO webhook_deliveries (
      webhook_id, event_type, payload, status_code, response_body, success
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    input.webhook_id,
    input.event_type,
    input.payload,
    input.status_code,
    input.response_body,
    input.success,
  )
  return Number(result.lastInsertRowid)
}

export function getWebhookDeliveries(
  db: Database.Database,
  webhookId: number,
  limit: number,
): WebhookDeliveryRow[] {
  return db.prepare(`
    SELECT *
    FROM webhook_deliveries
    WHERE webhook_id = ?
    ORDER BY attempted_at DESC, id DESC
    LIMIT ?
  `).all(webhookId, limit) as WebhookDeliveryRow[]
}

export function insertAuditLog(
  db: Database.Database,
  userId: string,
  log: AuditLogInput,
): void {
  db.prepare(`
    INSERT INTO audit_logs (
      user_id, session_id, project_slug, action_type, action_detail, file_path, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    log.session_id,
    log.project_slug ?? null,
    log.action_type,
    log.action_detail ?? null,
    log.file_path ?? null,
    log.metadata ?? null,
  )
}

export function getAuditLogs(
  db: Database.Database,
  userId: string,
  opts: { session_id?: string; project_slug?: string; action_type?: string; file_path?: string; limit?: number; offset?: number },
): AuditLog[] {
  const conditions = ['user_id = ?']
  const values: Array<string | number> = [userId]
  if (opts.session_id) { conditions.push('session_id = ?'); values.push(opts.session_id) }
  if (opts.project_slug) { conditions.push('project_slug = ?'); values.push(opts.project_slug) }
  if (opts.action_type) { conditions.push('action_type = ?'); values.push(opts.action_type) }
  if (opts.file_path) { conditions.push('file_path LIKE ?'); values.push(`%${opts.file_path}%`) }
  return db.prepare(`
    SELECT *
    FROM audit_logs
    WHERE ${conditions.join(' AND ')}
    ORDER BY timestamp DESC, id DESC
    LIMIT ? OFFSET ?
  `).all(...values, opts.limit ?? 100, opts.offset ?? 0) as AuditLog[]
}

export function getAuditLogsByFile(
  db: Database.Database,
  userId: string,
  filePath: string,
): AuditLog[] {
  return db.prepare(`
    SELECT *
    FROM audit_logs
    WHERE user_id = ? AND file_path = ?
    ORDER BY timestamp DESC, id DESC
  `).all(userId, filePath) as AuditLog[]
}

export function getAuditStats(
  db: Database.Database,
  userId: string,
  days: number,
): AuditStat[] {
  return db.prepare(`
    SELECT action_type, COUNT(*) AS count
    FROM audit_logs
    WHERE user_id = ? AND timestamp >= datetime('now', '-' || ? || ' days')
    GROUP BY action_type
    ORDER BY count DESC, action_type ASC
  `).all(userId, days) as AuditStat[]
}

export function createWorkflow(
  db: Database.Database,
  userId: string,
  workflow: WorkflowInput,
): void {
  db.prepare(`
    INSERT INTO workflows (
      id, user_id, name, trigger_type, trigger_filter, action_type, action_config, is_active, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    workflow.id,
    userId,
    workflow.name,
    workflow.trigger_type,
    workflow.trigger_filter ?? null,
    workflow.action_type,
    workflow.action_config,
    workflow.is_active ?? 1,
  )
}

export function getWorkflows(
  db: Database.Database,
  userId: string,
): Workflow[] {
  return db.prepare(`
    SELECT *
    FROM workflows
    WHERE user_id = ?
    ORDER BY created_at DESC, id DESC
  `).all(userId) as Workflow[]
}

export function getWorkflowById(
  db: Database.Database,
  userId: string,
  workflowId: string,
): Workflow | null {
  const row = db.prepare(`
    SELECT *
    FROM workflows
    WHERE user_id = ? AND id = ?
    LIMIT 1
  `).get(userId, workflowId) as Workflow | undefined
  return row ?? null
}

export function updateWorkflow(
  db: Database.Database,
  userId: string,
  workflowId: string,
  workflow: WorkflowUpdate,
): void {
  db.prepare(`
    UPDATE workflows
    SET name = ?, trigger_type = ?, trigger_filter = ?, action_type = ?, action_config = ?, is_active = ?, updated_at = datetime('now')
    WHERE user_id = ? AND id = ?
  `).run(
    workflow.name,
    workflow.trigger_type,
    workflow.trigger_filter ?? null,
    workflow.action_type,
    workflow.action_config,
    workflow.is_active ?? 1,
    userId,
    workflowId,
  )
}

export function deleteWorkflow(
  db: Database.Database,
  userId: string,
  workflowId: string,
): void {
  db.prepare('DELETE FROM workflows WHERE user_id = ? AND id = ?').run(userId, workflowId)
}

export function getActiveWorkflowsForTrigger(
  db: Database.Database,
  userId: string,
  triggerType: string,
  _sessionData?: Record<string, unknown>,
): Workflow[] {
  return db.prepare(`
    SELECT *
    FROM workflows
    WHERE user_id = ? AND trigger_type = ? AND is_active = 1
    ORDER BY created_at ASC, id ASC
  `).all(userId, triggerType) as Workflow[]
}

export function insertWorkflowRun(
  db: Database.Database,
  input: { workflow_id: string; trigger_session_id?: string | null; status?: WorkflowRunStatus; result?: string | null },
): number {
  const result = db.prepare(`
    INSERT INTO workflow_runs (workflow_id, trigger_session_id, status, result)
    VALUES (?, ?, ?, ?)
  `).run(
    input.workflow_id,
    input.trigger_session_id ?? null,
    input.status ?? 'pending',
    input.result ?? null,
  )
  return Number(result.lastInsertRowid)
}

export function updateWorkflowRun(
  db: Database.Database,
  runId: number,
  input: { status: WorkflowRunStatus; result?: string | null },
): void {
  db.prepare(`
    UPDATE workflow_runs
    SET status = ?, result = ?, completed_at = datetime('now')
    WHERE id = ?
  `).run(input.status, input.result ?? null, runId)
}

export function getWorkflowRuns(
  db: Database.Database,
  workflowId: string,
  limit: number,
): WorkflowRun[] {
  return db.prepare(`
    SELECT *
    FROM workflow_runs
    WHERE workflow_id = ?
    ORDER BY started_at DESC, id DESC
    LIMIT ?
  `).all(workflowId, limit) as WorkflowRun[]
}

export function getCostByProject(
  db: Database.Database,
  userId: string,
  days: number = 30,
): Array<{
  project_slug: string | null
  session_count: number
  input_tokens: number
  output_tokens: number
}> {
  return db.prepare(`
    SELECT
      project_slug,
      COUNT(*) AS session_count,
      SUM(total_input_tokens) AS input_tokens,
      SUM(total_output_tokens) AS output_tokens
    FROM cloud_sessions
    WHERE user_id = ? AND started_at >= datetime('now', '-' || ? || ' days')
    GROUP BY project_slug
    ORDER BY (SUM(total_input_tokens) + SUM(total_output_tokens)) DESC, project_slug ASC
  `).all(userId, days) as Array<{
    project_slug: string | null
    session_count: number
    input_tokens: number
    output_tokens: number
  }>
}

export function getCostBySession(
  db: Database.Database,
  userId: string,
  projectSlug?: string,
  days: number = 30,
): Array<{
  session_id: string
  project_slug: string | null
  started_at: string
  status: CloudSessionStatus
  input_tokens: number
  output_tokens: number
  tool_calls: number
  task: string | null
  summary: string | null
}> {
  const conditions = ['user_id = ?', "started_at >= datetime('now', '-' || ? || ' days')"]
  const values: Array<string | number> = [userId, days]

  if (projectSlug) {
    conditions.push('project_slug = ?')
    values.push(projectSlug)
  }

  return db.prepare(`
    SELECT
      session_id,
      project_slug,
      started_at,
      status,
      total_input_tokens AS input_tokens,
      total_output_tokens AS output_tokens,
      tool_calls,
      task,
      summary
    FROM cloud_sessions
    WHERE ${conditions.join(' AND ')}
    ORDER BY (total_input_tokens + total_output_tokens) DESC, started_at DESC
    LIMIT 50
  `).all(...values) as Array<{
    session_id: string
    project_slug: string | null
    started_at: string
    status: CloudSessionStatus
    input_tokens: number
    output_tokens: number
    tool_calls: number
    task: string | null
    summary: string | null
  }>
}

export function getCostByToolType(
  db: Database.Database,
  userId: string,
  days: number = 30,
): Array<{
  tool_name: string
  call_count: number
  input_tokens: number
  output_tokens: number
}> {
  return db.prepare(`
    SELECT
      tool_name,
      COUNT(*) AS call_count,
      SUM(input_tokens) AS input_tokens,
      SUM(output_tokens) AS output_tokens
    FROM cloud_events
    WHERE user_id = ?
      AND tool_name IS NOT NULL
      AND timestamp >= datetime('now', '-' || ? || ' days')
    GROUP BY tool_name
    ORDER BY (SUM(input_tokens) + SUM(output_tokens)) DESC, tool_name ASC
  `).all(userId, days) as Array<{
    tool_name: string
    call_count: number
    input_tokens: number
    output_tokens: number
  }>
}

export function createTeam(
  db: Database.Database,
  teamId: string,
  name: string,
  ownerId: string,
): Team {
  db.transaction(() => {
    db.prepare('INSERT INTO teams (id, name, owner_id) VALUES (?, ?, ?)').run(teamId, name, ownerId)
    db.prepare('INSERT INTO team_members (team_id, user_id, role, invited_by) VALUES (?, ?, ?, ?)').run(
      teamId,
      ownerId,
      'admin',
      ownerId,
    )
  })()
  return getTeamById(db, teamId) as Team
}

export function getTeamsByUser(db: Database.Database, userId: string): TeamListItem[] {
  return db.prepare(`
    SELECT t.id, t.name, t.owner_id, t.created_at, tm.role
    FROM team_members tm
    JOIN teams t ON t.id = tm.team_id
    WHERE tm.user_id = ?
    ORDER BY t.created_at DESC, t.name ASC
  `).all(userId) as TeamListItem[]
}

export function getTeamById(db: Database.Database, teamId: string): Team | null {
  const row = db.prepare(
    'SELECT id, name, owner_id, created_at FROM teams WHERE id = ? LIMIT 1',
  ).get(teamId) as Team | undefined
  return row ?? null
}

export function updateTeamName(
  db: Database.Database,
  teamId: string,
  ownerId: string,
  name: string,
): boolean {
  const result = db.prepare('UPDATE teams SET name = ? WHERE id = ? AND owner_id = ?').run(name, teamId, ownerId)
  return result.changes > 0
}

export function deleteTeam(db: Database.Database, teamId: string, ownerId: string): boolean {
  const result = db.transaction(() => {
    const existing = db.prepare('SELECT 1 FROM teams WHERE id = ? AND owner_id = ? LIMIT 1').get(
      teamId,
      ownerId,
    ) as { 1: number } | undefined
    if (!existing) {
      return false
    }
    db.prepare('DELETE FROM team_invites WHERE team_id = ?').run(teamId)
    db.prepare('DELETE FROM team_members WHERE team_id = ?').run(teamId)
    db.prepare('DELETE FROM teams WHERE id = ? AND owner_id = ?').run(teamId, ownerId)
    return true
  })()
  return result
}

export function getTeamMembers(db: Database.Database, teamId: string): TeamMember[] {
  return db.prepare(`
    SELECT tm.team_id, tm.user_id, tm.role, tm.invited_by, tm.joined_at,
           u.email, u.github_login, u.github_avatar_url
    FROM team_members tm
    JOIN users u ON u.id = tm.user_id
    WHERE tm.team_id = ?
    ORDER BY CASE tm.role WHEN 'admin' THEN 0 ELSE 1 END, tm.joined_at ASC
  `).all(teamId) as TeamMember[]
}

export function addTeamMember(
  db: Database.Database,
  teamId: string,
  userId: string,
  role: TeamMemberRole,
): void {
  db.prepare(`
    INSERT INTO team_members (team_id, user_id, role)
    VALUES (?, ?, ?)
    ON CONFLICT(team_id, user_id) DO UPDATE SET role = excluded.role
  `).run(teamId, userId, role)
}

export function updateMemberRole(
  db: Database.Database,
  teamId: string,
  userId: string,
  role: TeamMemberRole,
): boolean {
  const result = db.prepare('UPDATE team_members SET role = ? WHERE team_id = ? AND user_id = ?').run(
    role,
    teamId,
    userId,
  )
  return result.changes > 0
}

export function removeTeamMember(db: Database.Database, teamId: string, userId: string): boolean {
  const result = db.prepare('DELETE FROM team_members WHERE team_id = ? AND user_id = ?').run(teamId, userId)
  return result.changes > 0
}

export function isTeamMember(db: Database.Database, teamId: string, userId: string): boolean {
  const row = db.prepare(
    'SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ? LIMIT 1',
  ).get(teamId, userId) as { 1: number } | undefined
  return Boolean(row)
}

export function isTeamAdmin(db: Database.Database, teamId: string, userId: string): boolean {
  const row = db.prepare(
    "SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ? AND role = 'admin' LIMIT 1",
  ).get(teamId, userId) as { 1: number } | undefined
  return Boolean(row)
}

export function createTeamInvite(
  db: Database.Database,
  inviteId: string,
  teamId: string,
  email: string,
  invitedBy: string,
  expiresAt: string,
): TeamInvite {
  db.prepare(`
    INSERT INTO team_invites (id, team_id, email, invited_by, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(inviteId, teamId, email.toLowerCase(), invitedBy, expiresAt)
  return db.prepare(`
    SELECT id, team_id, email, invited_by, status, created_at, expires_at
    FROM team_invites WHERE id = ? LIMIT 1
  `).get(inviteId) as TeamInvite
}

export function getTeamInvites(db: Database.Database, teamId: string): TeamInvite[] {
  return db.prepare(`
    SELECT id, team_id, email, invited_by, status, created_at, expires_at
    FROM team_invites
    WHERE team_id = ? AND status = 'pending'
    ORDER BY created_at DESC
  `).all(teamId) as TeamInvite[]
}

export function acceptTeamInvite(db: Database.Database, inviteId: string, userId: string): TeamInvite | null {
  const invite = db.prepare(`
    SELECT id, team_id, email, invited_by, status, created_at, expires_at
    FROM team_invites WHERE id = ? LIMIT 1
  `).get(inviteId) as TeamInvite | undefined

  if (!invite) {
    return null
  }

  db.transaction(() => {
    db.prepare("UPDATE team_invites SET status = 'accepted' WHERE id = ?").run(inviteId)
    db.prepare(`
      INSERT INTO team_members (team_id, user_id, role, invited_by)
      VALUES (?, ?, 'member', ?)
      ON CONFLICT(team_id, user_id) DO NOTHING
    `).run(invite.team_id, userId, invite.invited_by)
  })()

  return { ...invite, status: 'accepted' }
}

export function getInviteByIdAndEmail(
  db: Database.Database,
  inviteId: string,
  email: string,
): TeamInvite | null {
  const row = db.prepare(`
    SELECT id, team_id, email, invited_by, status, created_at, expires_at
    FROM team_invites
    WHERE id = ? AND lower(email) = lower(?)
    LIMIT 1
  `).get(inviteId, email) as TeamInvite | undefined
  return row ?? null
}

export function getTeamSessions(
  db: Database.Database,
  teamId: string,
  opts: { days?: number; limit?: number; userId?: string } = {},
): TeamSession[] {
  const conditions = ["s.started_at >= datetime('now', '-' || ? || ' days')"]
  const values: Array<string | number> = [opts.days ?? 30]

  if (opts.userId) {
    conditions.push('s.user_id = ?')
    values.push(opts.userId)
  }

  return db.prepare(`
    SELECT s.session_id, s.user_id, u.email, u.github_login, s.project_slug, s.status,
           s.started_at, s.last_seen_at, s.total_input_tokens, s.total_output_tokens,
           s.tool_calls, s.task, s.summary
    FROM team_members tm
    JOIN cloud_sessions s ON s.user_id = tm.user_id
    JOIN users u ON u.id = s.user_id
    WHERE tm.team_id = ? AND ${conditions.join(' AND ')}
    ORDER BY s.last_seen_at DESC
    LIMIT ?
  `).all(teamId, ...values, opts.limit ?? 50) as TeamSession[]
}

export function getTeamUsageSummary(
  db: Database.Database,
  teamId: string,
  days: number,
): TeamUsageSummary {
  const row = db.prepare(`
    SELECT
      COUNT(s.session_id) AS session_count,
      COALESCE(SUM(s.total_input_tokens), 0) AS input_tokens,
      COALESCE(SUM(s.total_output_tokens), 0) AS output_tokens,
      COALESCE(SUM(s.tool_calls), 0) AS tool_calls,
      COUNT(DISTINCT tm.user_id) AS member_count,
      COUNT(DISTINCT s.user_id) AS active_members
    FROM team_members tm
    LEFT JOIN cloud_sessions s
      ON s.user_id = tm.user_id
     AND s.started_at >= datetime('now', '-' || ? || ' days')
    WHERE tm.team_id = ?
  `).get(days, teamId) as TeamUsageSummary | undefined

  return row ?? {
    session_count: 0,
    input_tokens: 0,
    output_tokens: 0,
    tool_calls: 0,
    member_count: 0,
    active_members: 0,
  }
}

export function getTeamWeeklyReport(
  db: Database.Database,
  teamId: string,
  weekStart: string,
): TeamWeeklyReportMember[] {
  return db.prepare(`
    SELECT
      tm.user_id,
      u.email,
      u.github_login,
      COUNT(s.session_id) AS session_count,
      COALESCE(SUM(s.total_input_tokens), 0) AS input_tokens,
      COALESCE(SUM(s.total_output_tokens), 0) AS output_tokens,
      COALESCE(SUM(s.tool_calls), 0) AS tool_calls
    FROM team_members tm
    JOIN users u ON u.id = tm.user_id
    LEFT JOIN cloud_sessions s
      ON s.user_id = tm.user_id
     AND s.started_at >= ?
     AND s.started_at < date(?, '+7 days')
    WHERE tm.team_id = ?
    GROUP BY tm.user_id, u.email, u.github_login
    ORDER BY (COALESCE(SUM(s.total_input_tokens), 0) + COALESCE(SUM(s.total_output_tokens), 0)) DESC, tm.joined_at ASC
  `).all(weekStart, weekStart, teamId) as TeamWeeklyReportMember[]
}

export function getSessionReplayEvents(
  db: Database.Database,
  userId: string,
  sessionId: string,
): Array<{
  id: number
  timestamp: string
  type: string
  role: string | null
  content_preview: string | null
  tool_name: string | null
  input_tokens: number
  output_tokens: number
  model: string | null
}> {
  return db.prepare(`
    SELECT
      local_id AS id,
      timestamp,
      type,
      role,
      content_preview,
      tool_name,
      input_tokens,
      output_tokens,
      model
    FROM cloud_events
    WHERE user_id = ? AND session_id = ?
    ORDER BY local_id ASC
    LIMIT 2000
  `).all(userId, sessionId) as Array<{
    id: number
    timestamp: string
    type: string
    role: string | null
    content_preview: string | null
    tool_name: string | null
    input_tokens: number
    output_tokens: number
    model: string | null
  }>
}
