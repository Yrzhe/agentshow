import type Database from 'better-sqlite3'
import {
  getActiveWorkflowsForTrigger,
  insertWorkflowRun,
  updateWorkflowRun,
} from '../db/queries.js'
import { sendWebhook } from './webhook-sender.js'

type WorkflowActionConfig = {
  url?: string
  method?: string
  headers?: Record<string, string>
  body_template?: string
  secret?: string | null
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  try {
    return value ? JSON.parse(value) as T : fallback
  } catch {
    return fallback
  }
}

function matchesFilter(filter: Record<string, unknown>, data: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, value]) => value == null || String(data[key] ?? '') === String(value))
}

function applyTemplate(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => String(data[key] ?? ''))
}

async function executeWorkflowAction(
  workflow: { action_type: string; action_config: string },
  data: Record<string, unknown>,
): Promise<{ success: boolean; detail: string }> {
  const config = parseJson<WorkflowActionConfig>(workflow.action_config, {})
  const url = config.url
  if (!url) {
    return { success: false, detail: 'Missing action URL' }
  }
  if (workflow.action_type === 'webhook') {
    const response = await sendWebhook(
      url,
      { event: String(data.status ?? 'workflow'), timestamp: new Date().toISOString(), data },
      config.secret ?? null,
    )
    return { success: response.success, detail: response.response_body || String(response.status_code) }
  }
  const body = config.body_template ? applyTemplate(config.body_template, data) : JSON.stringify(data)
  try {
    const response = await fetch(url, {
      method: config.method ?? 'POST',
      headers: { 'Content-Type': 'application/json', ...(config.headers ?? {}) },
      body,
    })
    return { success: response.ok, detail: await response.text() }
  } catch (error) {
    return { success: false, detail: error instanceof Error ? error.message : 'Request failed' }
  }
}

export async function executeWorkflows(
  db: Database.Database,
  userId: string,
  triggerType: string,
  triggerData: Record<string, unknown>,
): Promise<void> {
  const workflows = getActiveWorkflowsForTrigger(db, userId, triggerType)
    .filter((workflow) => matchesFilter(parseJson<Record<string, unknown>>(workflow.trigger_filter, {}), triggerData))
  await Promise.all(workflows.map(async (workflow) => {
    const runId = insertWorkflowRun(db, {
      workflow_id: workflow.id,
      trigger_session_id: String(triggerData.session_id ?? ''),
      status: 'running',
    })
    const result = await executeWorkflowAction(workflow, triggerData)
    updateWorkflowRun(db, runId, {
      status: result.success ? 'success' : 'failed',
      result: result.detail,
    })
  }))
}
