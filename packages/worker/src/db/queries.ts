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

export async function upsertCloudSession(
  db: D1Database,
  userId: string,
  session: SyncSession,
  deviceId: string,
): Promise<void> {
  await db.prepare(
    `
      INSERT OR REPLACE INTO cloud_sessions (
        session_id, user_id, device_id, pid, cwd, project_slug, status,
        started_at, last_seen_at, message_count, total_input_tokens,
        total_output_tokens, tool_calls, task, files, synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `,
  ).bind(
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
  ).run()
}

export async function getCloudSessions(
  db: D1Database,
  userId: string,
  opts: SessionQueryOptions = {},
): Promise<CloudSession[]> {
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

  const { results } = await db.prepare(
    `
      SELECT *
      FROM cloud_sessions
      WHERE ${conditions.join(' AND ')}
      ORDER BY last_seen_at DESC, session_id ASC
      LIMIT ? OFFSET ?
    `,
  ).bind(...values, opts.limit ?? 100, opts.offset ?? 0).all<CloudSession>()

  return results ?? []
}

export async function getCloudSession(
  db: D1Database,
  userId: string,
  sessionId: string,
): Promise<CloudSession | null> {
  const row = await db.prepare(
    'SELECT * FROM cloud_sessions WHERE user_id = ? AND session_id = ? LIMIT 1',
  ).bind(userId, sessionId).first<CloudSession>()

  return row ?? null
}

export async function getCloudSessionStats(
  db: D1Database,
  userId: string,
  sessionId: string,
): Promise<SessionStats> {
  const row = await db.prepare(
    `
      SELECT total_input_tokens, total_output_tokens, tool_calls, message_count
      FROM cloud_sessions
      WHERE user_id = ? AND session_id = ?
      LIMIT 1
    `,
  ).bind(userId, sessionId).first<SessionStats>()

  return row ?? {
    total_input_tokens: 0,
    total_output_tokens: 0,
    tool_calls: 0,
    message_count: 0,
  }
}

export async function updateSessionSummary(
  db: D1Database,
  userId: string,
  sessionId: string,
  summary: string,
): Promise<void> {
  await db.prepare(
    'UPDATE cloud_sessions SET summary = ? WHERE session_id = ? AND user_id = ?',
  ).bind(summary, sessionId, userId).run()
}

export async function insertCloudEvents(
  db: D1Database,
  userId: string,
  events: SyncEvent[],
): Promise<void> {
  if (events.length === 0) {
    return
  }

  await db.batch(events.map((event) =>
    db.prepare(
      `
        INSERT INTO cloud_events (
          user_id, session_id, local_id, type, role, content_preview,
          tool_name, input_tokens, output_tokens, model, timestamp, synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `,
    ).bind(
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
    ),
  ))
}

export async function getCloudEvents(
  db: D1Database,
  userId: string,
  sessionId: string,
  opts: EventQueryOptions = {},
): Promise<SyncEvent[]> {
  const { results } = await db.prepare(
    `
      SELECT local_id, session_id, type, role, content_preview, tool_name,
             input_tokens, output_tokens, model, timestamp
      FROM cloud_events
      WHERE user_id = ? AND session_id = ?
        AND type IN ('user', 'assistant', 'system')
      ORDER BY local_id DESC
      LIMIT ?
    `,
  ).bind(userId, sessionId, opts.limit ?? 100).all<SyncEvent>()

  return (results ?? []).reverse()
}

export async function getCloudProjects(db: D1Database, userId: string): Promise<CloudProject[]> {
  const { results } = await db.prepare(
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
  ).bind(userId).all<CloudProject>()

  return results ?? []
}

export async function getWatermark(
  db: D1Database,
  userId: string,
  deviceId: string,
): Promise<Watermark> {
  const row = await db.prepare(
    `
      SELECT last_session_seen_at, last_event_local_id
      FROM sync_watermarks
      WHERE user_id = ? AND device_id = ?
      LIMIT 1
    `,
  ).bind(userId, deviceId).first<Watermark>()

  return row ?? { last_session_seen_at: null, last_event_local_id: 0 }
}

export async function updateWatermark(
  db: D1Database,
  userId: string,
  deviceId: string,
  sessionSeenAt: string | null,
  eventLocalId: number,
): Promise<void> {
  await db.prepare(
    `
      INSERT OR REPLACE INTO sync_watermarks (
        user_id, device_id, last_session_seen_at, last_event_local_id, updated_at
      ) VALUES (?, ?, ?, ?, datetime('now'))
    `,
  ).bind(userId, deviceId, sessionSeenAt, eventLocalId).run()
}

export async function searchCloudEvents(
  db: D1Database,
  userId: string,
  query: string,
  opts: { limit: number; offset: number },
): Promise<{ results: SearchResult[]; total: number }> {
  const countRow = await db.prepare(
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
  ).bind(userId, query, query, query, query, userId, query, query).first<{ total: number }>()

  const { results } = await db.prepare(
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
  ).bind(
    userId, query, query, query, query,
    userId, query, query,
    opts.limit, opts.offset,
  ).all<SearchResult>()

  return {
    results: results ?? [],
    total: Number(countRow?.total ?? 0),
  }
}

export async function upsertCloudNote(
  db: D1Database,
  userId: string,
  deviceId: string,
  note: SyncNote,
  projectSlug: string | null,
): Promise<void> {
  await db.prepare(`
    INSERT OR REPLACE INTO cloud_notes (
      user_id, device_id, project_id, project_slug, key, content,
      session_id, created_at, updated_at, synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).bind(
    userId, deviceId, note.project_id, projectSlug, note.key, note.content,
    note.session_id, note.created_at, note.updated_at,
  ).run()
}

export async function getCloudNotes(
  db: D1Database,
  userId: string,
  opts: { project_slug?: string | null | undefined; session_id?: string | null | undefined; limit?: number },
): Promise<CloudNote[]> {
  const conditions = ['user_id = ?']
  const values: Array<string | number> = [userId]
  if (opts.project_slug) { conditions.push('project_slug = ?'); values.push(opts.project_slug) }
  if (opts.session_id) { conditions.push('session_id = ?'); values.push(opts.session_id) }
  const { results } = await db.prepare(`
    SELECT * FROM cloud_notes WHERE ${conditions.join(' AND ')}
    ORDER BY updated_at DESC LIMIT ?
  `).bind(...values, opts.limit ?? 50).all<CloudNote>()
  return results ?? []
}

export async function getTokensByDay(
  db: D1Database,
  userId: string,
  days: number = 14,
): Promise<Array<{ date: string; input_tokens: number; output_tokens: number }>> {
  const { results } = await db.prepare(`
    SELECT
      date(started_at) AS date,
      SUM(total_input_tokens) AS input_tokens,
      SUM(total_output_tokens) AS output_tokens
    FROM cloud_sessions
    WHERE user_id = ? AND started_at >= datetime('now', '-' || ? || ' days')
    GROUP BY date(started_at)
    ORDER BY date ASC
  `).bind(userId, days).all()
  return (results ?? []) as Array<{ date: string; input_tokens: number; output_tokens: number }>
}

export async function getBudgetSettings(
  db: D1Database,
  userId: string,
): Promise<BudgetSetting[]> {
  const { results } = await db.prepare(`
    SELECT budget_type, limit_usd, alert_threshold
    FROM budget_settings
    WHERE user_id = ?
    ORDER BY CASE budget_type WHEN 'daily' THEN 0 ELSE 1 END
  `).bind(userId).all<BudgetSetting>()
  return results ?? []
}

export async function upsertBudgetSetting(
  db: D1Database,
  userId: string,
  budgetType: BudgetType,
  limitUsd: number,
  alertThreshold: number,
): Promise<void> {
  await db.prepare(`
    INSERT INTO budget_settings (user_id, budget_type, limit_usd, alert_threshold, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, budget_type) DO UPDATE SET
      limit_usd = excluded.limit_usd,
      alert_threshold = excluded.alert_threshold,
      updated_at = datetime('now')
  `).bind(userId, budgetType, limitUsd, alertThreshold).run()
}

export async function deleteBudgetSetting(
  db: D1Database,
  userId: string,
  budgetType: BudgetType,
): Promise<void> {
  await db.prepare(
    'DELETE FROM budget_settings WHERE user_id = ? AND budget_type = ?',
  ).bind(userId, budgetType).run()
}

export async function getWebhookConfigs(
  db: D1Database,
  userId: string,
): Promise<WebhookConfigRow[]> {
  const { results } = await db.prepare(`
    SELECT *
    FROM webhook_configs
    WHERE user_id = ?
    ORDER BY created_at DESC, id DESC
  `).bind(userId).all<WebhookConfigRow>()
  return results ?? []
}

export async function getWebhookConfigById(
  db: D1Database,
  userId: string,
  webhookId: number,
): Promise<WebhookConfigRow | null> {
  const row = await db.prepare(`
    SELECT *
    FROM webhook_configs
    WHERE user_id = ? AND id = ?
    LIMIT 1
  `).bind(userId, webhookId).first<WebhookConfigRow>()
  return row ?? null
}

export async function createWebhookConfig(
  db: D1Database,
  userId: string,
  input: WebhookConfigInput,
): Promise<number> {
  const result = await db.prepare(`
    INSERT INTO webhook_configs (user_id, name, url, secret, events, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `).bind(userId, input.name, input.url, input.secret ?? null, input.events).run()
  return Number(result.meta.last_row_id)
}

export async function updateWebhookConfig(
  db: D1Database,
  userId: string,
  webhookId: number,
  input: WebhookConfigUpdate,
): Promise<void> {
  await db.prepare(`
    UPDATE webhook_configs
    SET name = ?, url = ?, secret = ?, events = ?, is_active = ?, updated_at = datetime('now')
    WHERE user_id = ? AND id = ?
  `).bind(
    input.name,
    input.url,
    input.secret ?? null,
    input.events,
    input.is_active,
    userId,
    webhookId,
  ).run()
}

export async function deleteWebhookConfig(
  db: D1Database,
  userId: string,
  webhookId: number,
): Promise<void> {
  await db.prepare('DELETE FROM webhook_configs WHERE user_id = ? AND id = ?')
    .bind(userId, webhookId)
    .run()
}

export async function getActiveWebhooksForEvent(
  db: D1Database,
  userId: string,
  eventType: string,
): Promise<WebhookConfigRow[]> {
  const { results } = await db.prepare(`
    SELECT *
    FROM webhook_configs
    WHERE user_id = ?
      AND is_active = 1
      AND instr(',' || replace(events, ' ', '') || ',', ',' || ? || ',') > 0
    ORDER BY id ASC
  `).bind(userId, eventType).all<WebhookConfigRow>()
  return results ?? []
}

export async function insertWebhookDelivery(
  db: D1Database,
  input: WebhookDeliveryInput,
): Promise<number> {
  const result = await db.prepare(`
    INSERT INTO webhook_deliveries (
      webhook_id, event_type, payload, status_code, response_body, success
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    input.webhook_id,
    input.event_type,
    input.payload,
    input.status_code,
    input.response_body,
    input.success,
  ).run()
  return Number(result.meta.last_row_id)
}

export async function getWebhookDeliveries(
  db: D1Database,
  webhookId: number,
  limit: number,
): Promise<WebhookDeliveryRow[]> {
  const { results } = await db.prepare(`
    SELECT *
    FROM webhook_deliveries
    WHERE webhook_id = ?
    ORDER BY attempted_at DESC, id DESC
    LIMIT ?
  `).bind(webhookId, limit).all<WebhookDeliveryRow>()
  return results ?? []
}

export async function insertAuditLog(
  db: D1Database,
  userId: string,
  log: AuditLogInput,
): Promise<void> {
  await db.prepare(`
    INSERT INTO audit_logs (
      user_id, session_id, project_slug, action_type, action_detail, file_path, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    userId,
    log.session_id,
    log.project_slug ?? null,
    log.action_type,
    log.action_detail ?? null,
    log.file_path ?? null,
    log.metadata ?? null,
  ).run()
}

export async function getAuditLogs(
  db: D1Database,
  userId: string,
  opts: { session_id?: string; project_slug?: string; action_type?: string; file_path?: string; limit?: number; offset?: number },
): Promise<AuditLog[]> {
  const conditions = ['user_id = ?']
  const values: Array<string | number> = [userId]
  if (opts.session_id) { conditions.push('session_id = ?'); values.push(opts.session_id) }
  if (opts.project_slug) { conditions.push('project_slug = ?'); values.push(opts.project_slug) }
  if (opts.action_type) { conditions.push('action_type = ?'); values.push(opts.action_type) }
  if (opts.file_path) { conditions.push('file_path LIKE ?'); values.push(`%${opts.file_path}%`) }
  const { results } = await db.prepare(`
    SELECT *
    FROM audit_logs
    WHERE ${conditions.join(' AND ')}
    ORDER BY timestamp DESC, id DESC
    LIMIT ? OFFSET ?
  `).bind(...values, opts.limit ?? 100, opts.offset ?? 0).all<AuditLog>()
  return results ?? []
}

export async function getAuditLogsByFile(
  db: D1Database,
  userId: string,
  filePath: string,
): Promise<AuditLog[]> {
  const { results } = await db.prepare(`
    SELECT *
    FROM audit_logs
    WHERE user_id = ? AND file_path = ?
    ORDER BY timestamp DESC, id DESC
  `).bind(userId, filePath).all<AuditLog>()
  return results ?? []
}

export async function getAuditStats(
  db: D1Database,
  userId: string,
  days: number,
): Promise<AuditStat[]> {
  const { results } = await db.prepare(`
    SELECT action_type, COUNT(*) AS count
    FROM audit_logs
    WHERE user_id = ? AND timestamp >= datetime('now', '-' || ? || ' days')
    GROUP BY action_type
    ORDER BY count DESC, action_type ASC
  `).bind(userId, days).all<AuditStat>()
  return results ?? []
}

export async function createWorkflow(
  db: D1Database,
  userId: string,
  workflow: WorkflowInput,
): Promise<void> {
  await db.prepare(`
    INSERT INTO workflows (
      id, user_id, name, trigger_type, trigger_filter, action_type, action_config, is_active, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).bind(
    workflow.id,
    userId,
    workflow.name,
    workflow.trigger_type,
    workflow.trigger_filter ?? null,
    workflow.action_type,
    workflow.action_config,
    workflow.is_active ?? 1,
  ).run()
}

export async function getWorkflows(
  db: D1Database,
  userId: string,
): Promise<Workflow[]> {
  const { results } = await db.prepare(`
    SELECT *
    FROM workflows
    WHERE user_id = ?
    ORDER BY created_at DESC, id DESC
  `).bind(userId).all<Workflow>()
  return results ?? []
}

export async function getWorkflowById(
  db: D1Database,
  userId: string,
  workflowId: string,
): Promise<Workflow | null> {
  const row = await db.prepare(`
    SELECT *
    FROM workflows
    WHERE user_id = ? AND id = ?
    LIMIT 1
  `).bind(userId, workflowId).first<Workflow>()
  return row ?? null
}

export async function updateWorkflow(
  db: D1Database,
  userId: string,
  workflowId: string,
  workflow: WorkflowUpdate,
): Promise<void> {
  await db.prepare(`
    UPDATE workflows
    SET name = ?, trigger_type = ?, trigger_filter = ?, action_type = ?, action_config = ?, is_active = ?, updated_at = datetime('now')
    WHERE user_id = ? AND id = ?
  `).bind(
    workflow.name,
    workflow.trigger_type,
    workflow.trigger_filter ?? null,
    workflow.action_type,
    workflow.action_config,
    workflow.is_active ?? 1,
    userId,
    workflowId,
  ).run()
}

export async function deleteWorkflow(
  db: D1Database,
  userId: string,
  workflowId: string,
): Promise<void> {
  await db.prepare('DELETE FROM workflows WHERE user_id = ? AND id = ?')
    .bind(userId, workflowId)
    .run()
}

export async function getActiveWorkflowsForTrigger(
  db: D1Database,
  userId: string,
  triggerType: string,
  _sessionData?: Record<string, unknown>,
): Promise<Workflow[]> {
  const { results } = await db.prepare(`
    SELECT *
    FROM workflows
    WHERE user_id = ? AND trigger_type = ? AND is_active = 1
    ORDER BY created_at ASC, id ASC
  `).bind(userId, triggerType).all<Workflow>()
  return results ?? []
}

export async function insertWorkflowRun(
  db: D1Database,
  input: { workflow_id: string; trigger_session_id?: string | null; status?: WorkflowRunStatus; result?: string | null },
): Promise<number> {
  const result = await db.prepare(`
    INSERT INTO workflow_runs (workflow_id, trigger_session_id, status, result)
    VALUES (?, ?, ?, ?)
  `).bind(
    input.workflow_id,
    input.trigger_session_id ?? null,
    input.status ?? 'pending',
    input.result ?? null,
  ).run()
  return Number(result.meta.last_row_id)
}

export async function updateWorkflowRun(
  db: D1Database,
  runId: number,
  input: { status: WorkflowRunStatus; result?: string | null },
): Promise<void> {
  await db.prepare(`
    UPDATE workflow_runs
    SET status = ?, result = ?, completed_at = datetime('now')
    WHERE id = ?
  `).bind(input.status, input.result ?? null, runId).run()
}

export async function getWorkflowRuns(
  db: D1Database,
  workflowId: string,
  limit: number,
): Promise<WorkflowRun[]> {
  const { results } = await db.prepare(`
    SELECT *
    FROM workflow_runs
    WHERE workflow_id = ?
    ORDER BY started_at DESC, id DESC
    LIMIT ?
  `).bind(workflowId, limit).all<WorkflowRun>()
  return results ?? []
}

export async function getCostByProject(
  db: D1Database,
  userId: string,
  days: number = 30,
): Promise<Array<{
  project_slug: string | null
  session_count: number
  input_tokens: number
  output_tokens: number
}>> {
  const { results } = await db.prepare(`
    SELECT
      project_slug,
      COUNT(*) AS session_count,
      SUM(total_input_tokens) AS input_tokens,
      SUM(total_output_tokens) AS output_tokens
    FROM cloud_sessions
    WHERE user_id = ? AND started_at >= datetime('now', '-' || ? || ' days')
    GROUP BY project_slug
    ORDER BY (SUM(total_input_tokens) + SUM(total_output_tokens)) DESC, project_slug ASC
  `).bind(userId, days).all()
  return (results ?? []) as Array<{
    project_slug: string | null
    session_count: number
    input_tokens: number
    output_tokens: number
  }>
}

export async function getCostBySession(
  db: D1Database,
  userId: string,
  projectSlug?: string,
  days: number = 30,
): Promise<Array<{
  session_id: string
  project_slug: string | null
  started_at: string
  status: CloudSessionStatus
  input_tokens: number
  output_tokens: number
  tool_calls: number
  task: string | null
  summary: string | null
}>> {
  const conditions = ['user_id = ?', "started_at >= datetime('now', '-' || ? || ' days')"]
  const values: Array<string | number> = [userId, days]

  if (projectSlug) {
    conditions.push('project_slug = ?')
    values.push(projectSlug)
  }

  const { results } = await db.prepare(`
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
  `).bind(...values).all()

  return (results ?? []) as Array<{
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

export async function getCostByToolType(
  db: D1Database,
  userId: string,
  days: number = 30,
): Promise<Array<{
  tool_name: string
  call_count: number
  input_tokens: number
  output_tokens: number
}>> {
  const { results } = await db.prepare(`
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
  `).bind(userId, days).all()
  return (results ?? []) as Array<{
    tool_name: string
    call_count: number
    input_tokens: number
    output_tokens: number
  }>
}

export async function createTeam(
  db: D1Database,
  teamId: string,
  name: string,
  ownerId: string,
): Promise<Team> {
  await db.batch([
    db.prepare('INSERT INTO teams (id, name, owner_id) VALUES (?, ?, ?)').bind(teamId, name, ownerId),
    db.prepare('INSERT INTO team_members (team_id, user_id, role, invited_by) VALUES (?, ?, ?, ?)').bind(
      teamId,
      ownerId,
      'admin',
      ownerId,
    ),
  ])
  return await getTeamById(db, teamId) as Team
}

export async function getTeamsByUser(db: D1Database, userId: string): Promise<TeamListItem[]> {
  const { results } = await db.prepare(`
    SELECT t.id, t.name, t.owner_id, t.created_at, tm.role
    FROM team_members tm
    JOIN teams t ON t.id = tm.team_id
    WHERE tm.user_id = ?
    ORDER BY t.created_at DESC, t.name ASC
  `).bind(userId).all<TeamListItem>()
  return results ?? []
}

export async function getTeamById(db: D1Database, teamId: string): Promise<Team | null> {
  const row = await db.prepare(
    'SELECT id, name, owner_id, created_at FROM teams WHERE id = ? LIMIT 1',
  ).bind(teamId).first<Team>()
  return row ?? null
}

export async function updateTeamName(
  db: D1Database,
  teamId: string,
  ownerId: string,
  name: string,
): Promise<boolean> {
  const result = await db.prepare('UPDATE teams SET name = ? WHERE id = ? AND owner_id = ?').bind(
    name,
    teamId,
    ownerId,
  ).run()
  return Boolean(result.meta.changes)
}

export async function deleteTeam(db: D1Database, teamId: string, ownerId: string): Promise<boolean> {
  const existing = await db.prepare('SELECT 1 FROM teams WHERE id = ? AND owner_id = ? LIMIT 1').bind(
    teamId,
    ownerId,
  ).first<{ 1: number }>()
  if (!existing) {
    return false
  }
  await db.batch([
    db.prepare('DELETE FROM team_invites WHERE team_id = ?').bind(teamId),
    db.prepare('DELETE FROM team_members WHERE team_id = ?').bind(teamId),
    db.prepare('DELETE FROM teams WHERE id = ? AND owner_id = ?').bind(teamId, ownerId),
  ])
  return true
}

export async function getTeamMembers(db: D1Database, teamId: string): Promise<TeamMember[]> {
  const { results } = await db.prepare(`
    SELECT tm.team_id, tm.user_id, tm.role, tm.invited_by, tm.joined_at,
           u.email, u.github_login, u.github_avatar_url
    FROM team_members tm
    JOIN users u ON u.id = tm.user_id
    WHERE tm.team_id = ?
    ORDER BY CASE tm.role WHEN 'admin' THEN 0 ELSE 1 END, tm.joined_at ASC
  `).bind(teamId).all<TeamMember>()
  return results ?? []
}

export async function addTeamMember(
  db: D1Database,
  teamId: string,
  userId: string,
  role: TeamMemberRole,
): Promise<void> {
  await db.prepare(`
    INSERT INTO team_members (team_id, user_id, role)
    VALUES (?, ?, ?)
    ON CONFLICT(team_id, user_id) DO UPDATE SET role = excluded.role
  `).bind(teamId, userId, role).run()
}

export async function updateMemberRole(
  db: D1Database,
  teamId: string,
  userId: string,
  role: TeamMemberRole,
): Promise<boolean> {
  const result = await db.prepare('UPDATE team_members SET role = ? WHERE team_id = ? AND user_id = ?').bind(
    role,
    teamId,
    userId,
  ).run()
  return Boolean(result.meta.changes)
}

export async function removeTeamMember(db: D1Database, teamId: string, userId: string): Promise<boolean> {
  const result = await db.prepare('DELETE FROM team_members WHERE team_id = ? AND user_id = ?').bind(
    teamId,
    userId,
  ).run()
  return Boolean(result.meta.changes)
}

export async function isTeamMember(db: D1Database, teamId: string, userId: string): Promise<boolean> {
  const row = await db.prepare(
    'SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ? LIMIT 1',
  ).bind(teamId, userId).first<{ 1: number }>()
  return Boolean(row)
}

export async function isTeamAdmin(db: D1Database, teamId: string, userId: string): Promise<boolean> {
  const row = await db.prepare(
    "SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ? AND role = 'admin' LIMIT 1",
  ).bind(teamId, userId).first<{ 1: number }>()
  return Boolean(row)
}

export async function createTeamInvite(
  db: D1Database,
  inviteId: string,
  teamId: string,
  email: string,
  invitedBy: string,
  expiresAt: string,
): Promise<TeamInvite> {
  await db.prepare(`
    INSERT INTO team_invites (id, team_id, email, invited_by, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(inviteId, teamId, email.toLowerCase(), invitedBy, expiresAt).run()
  return await db.prepare(`
    SELECT id, team_id, email, invited_by, status, created_at, expires_at
    FROM team_invites WHERE id = ? LIMIT 1
  `).bind(inviteId).first<TeamInvite>() as TeamInvite
}

export async function getTeamInvites(db: D1Database, teamId: string): Promise<TeamInvite[]> {
  const { results } = await db.prepare(`
    SELECT id, team_id, email, invited_by, status, created_at, expires_at
    FROM team_invites
    WHERE team_id = ? AND status = 'pending'
    ORDER BY created_at DESC
  `).bind(teamId).all<TeamInvite>()
  return results ?? []
}

export async function acceptTeamInvite(db: D1Database, inviteId: string, userId: string): Promise<TeamInvite | null> {
  const invite = await db.prepare(`
    SELECT id, team_id, email, invited_by, status, created_at, expires_at
    FROM team_invites WHERE id = ? LIMIT 1
  `).bind(inviteId).first<TeamInvite>()

  if (!invite) {
    return null
  }

  await db.batch([
    db.prepare("UPDATE team_invites SET status = 'accepted' WHERE id = ?").bind(inviteId),
    db.prepare(`
      INSERT INTO team_members (team_id, user_id, role, invited_by)
      VALUES (?, ?, 'member', ?)
      ON CONFLICT(team_id, user_id) DO NOTHING
    `).bind(invite.team_id, userId, invite.invited_by),
  ])

  return { ...invite, status: 'accepted' }
}

export async function getInviteByIdAndEmail(
  db: D1Database,
  inviteId: string,
  email: string,
): Promise<TeamInvite | null> {
  const row = await db.prepare(`
    SELECT id, team_id, email, invited_by, status, created_at, expires_at
    FROM team_invites
    WHERE id = ? AND lower(email) = lower(?)
    LIMIT 1
  `).bind(inviteId, email).first<TeamInvite>()
  return row ?? null
}

export async function getTeamSessions(
  db: D1Database,
  teamId: string,
  opts: { days?: number; limit?: number; userId?: string } = {},
): Promise<TeamSession[]> {
  const conditions = ["s.started_at >= datetime('now', '-' || ? || ' days')"]
  const values: Array<string | number> = [opts.days ?? 30]

  if (opts.userId) {
    conditions.push('s.user_id = ?')
    values.push(opts.userId)
  }

  const { results } = await db.prepare(`
    SELECT s.session_id, s.user_id, u.email, u.github_login, s.project_slug, s.status,
           s.started_at, s.last_seen_at, s.total_input_tokens, s.total_output_tokens,
           s.tool_calls, s.task, s.summary
    FROM team_members tm
    JOIN cloud_sessions s ON s.user_id = tm.user_id
    JOIN users u ON u.id = s.user_id
    WHERE tm.team_id = ? AND ${conditions.join(' AND ')}
    ORDER BY s.last_seen_at DESC
    LIMIT ?
  `).bind(teamId, ...values, opts.limit ?? 50).all<TeamSession>()
  return results ?? []
}

export async function getTeamUsageSummary(
  db: D1Database,
  teamId: string,
  days: number,
): Promise<TeamUsageSummary> {
  const row = await db.prepare(`
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
  `).bind(days, teamId).first<TeamUsageSummary>()

  return row ?? {
    session_count: 0,
    input_tokens: 0,
    output_tokens: 0,
    tool_calls: 0,
    member_count: 0,
    active_members: 0,
  }
}

export async function getTeamWeeklyReport(
  db: D1Database,
  teamId: string,
  weekStart: string,
): Promise<TeamWeeklyReportMember[]> {
  const { results } = await db.prepare(`
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
  `).bind(weekStart, weekStart, teamId).all<TeamWeeklyReportMember>()
  return results ?? []
}

export async function getSessionReplayEvents(
  db: D1Database,
  userId: string,
  sessionId: string,
): Promise<Array<{
  id: number
  timestamp: string
  type: string
  role: string | null
  content_preview: string | null
  tool_name: string | null
  input_tokens: number
  output_tokens: number
  model: string | null
}>> {
  const { results } = await db.prepare(`
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
  `).bind(userId, sessionId).all()
  return (results ?? []) as Array<{
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
