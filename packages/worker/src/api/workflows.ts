import { Hono } from 'hono'
import {
  createWorkflow,
  deleteWorkflow,
  getWorkflowById,
  getWorkflowRuns,
  getWorkflows,
  updateWorkflow,
} from '../db/queries.js'
import { executeWorkflows } from '../lib/workflow-engine.js'
import { generateId } from '../lib/id.js'
import type { AppType } from '../index.js'
import { flexAuth } from '../middleware/auth.js'

type WorkflowBody = {
  name?: string
  trigger_type?: string
  trigger_filter?: Record<string, unknown> | string | null
  action_type?: 'webhook' | 'daemon_api'
  action_config?: Record<string, unknown> | string
  is_active?: boolean | number
}

function normalizeStringified(value: WorkflowBody['trigger_filter'] | WorkflowBody['action_config']): string {
  return typeof value === 'string' ? value : JSON.stringify(value ?? {})
}

function normalizeBody(body: WorkflowBody, id: string) {
  const name = String(body.name ?? '').trim()
  if (!name) {
    return null
  }
  return {
    id,
    name,
    trigger_type: String(body.trigger_type ?? 'session.ended'),
    trigger_filter: normalizeStringified(body.trigger_filter),
    action_type: body.action_type ?? 'webhook',
    action_config: normalizeStringified(body.action_config),
    is_active: body.is_active === undefined ? 1 : (Number(body.is_active) ? 1 : 0),
  }
}

export const workflowRoutes = new Hono<AppType>()
workflowRoutes.use('*', flexAuth())

workflowRoutes.get('/', async (c) => c.json({ workflows: await getWorkflows(c.env.DB, c.get('userId')) }))

workflowRoutes.post('/', async (c) => {
  const workflow = normalizeBody(await c.req.json<WorkflowBody>(), generateId())
  if (!workflow) return c.json({ error: 'name is required' }, 400)
  await createWorkflow(c.env.DB, c.get('userId'), workflow)
  return c.json({ workflow: await getWorkflowById(c.env.DB, c.get('userId'), workflow.id) }, 201)
})

workflowRoutes.put('/:id', async (c) => {
  const existing = await getWorkflowById(c.env.DB, c.get('userId'), c.req.param('id'))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  const workflow = normalizeBody(await c.req.json<WorkflowBody>(), existing.id)
  if (!workflow) return c.json({ error: 'name is required' }, 400)
  await updateWorkflow(c.env.DB, c.get('userId'), existing.id, workflow)
  return c.json({ workflow: await getWorkflowById(c.env.DB, c.get('userId'), existing.id) })
})

workflowRoutes.delete('/:id', async (c) => {
  await deleteWorkflow(c.env.DB, c.get('userId'), c.req.param('id'))
  return c.json({ status: 'ok' })
})

workflowRoutes.get('/:id/runs', async (c) => {
  return c.json({ runs: await getWorkflowRuns(c.env.DB, c.req.param('id'), Math.min(Number(c.req.query('limit')) || 20, 100)) })
})

workflowRoutes.post('/:id/test', async (c) => {
  const workflow = await getWorkflowById(c.env.DB, c.get('userId'), c.req.param('id'))
  if (!workflow) return c.json({ error: 'Not found' }, 404)
  await executeWorkflows(c.env.DB, c.get('userId'), workflow.trigger_type, {
    session_id: 'test-session',
    project_slug: 'test-project',
    status: 'ended',
  })
  return c.json({ status: 'ok' })
})
