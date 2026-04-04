import { Hono } from 'hono'
import {
  getCostByProject,
  getCostBySession,
  getCostByToolType,
} from '../db/queries.js'
import type { AppType } from '../index.js'
import { flexAuth } from '../middleware/auth.js'
import { estimateCost } from './usage.js'

const roundCost = (value: number): number => Math.round(value * 10000) / 10000

export const costAttributionRoutes = new Hono<AppType>()
costAttributionRoutes.use('*', flexAuth())

costAttributionRoutes.get('/by-project', async (c) => {
  const userId = c.get('userId')
  const days = Math.min(Number(c.req.query('days')) || 30, 365)
  const projects = (await getCostByProject(c.env.DB, userId, days)).map((row) => ({
    project_slug: row.project_slug,
    session_count: Number(row.session_count ?? 0),
    input_tokens: Number(row.input_tokens ?? 0),
    output_tokens: Number(row.output_tokens ?? 0),
    estimated_cost: roundCost(estimateCost(Number(row.input_tokens ?? 0), Number(row.output_tokens ?? 0))),
  }))
  return c.json({ projects, period_days: days })
})

costAttributionRoutes.get('/by-session', async (c) => {
  const userId = c.get('userId')
  const days = Math.min(Number(c.req.query('days')) || 30, 365)
  const projectSlug = c.req.query('project') || undefined
  const sessions = (await getCostBySession(c.env.DB, userId, projectSlug, days)).map((row) => ({
    session_id: row.session_id,
    project_slug: row.project_slug,
    started_at: row.started_at,
    status: row.status,
    input_tokens: Number(row.input_tokens ?? 0),
    output_tokens: Number(row.output_tokens ?? 0),
    tool_calls: Number(row.tool_calls ?? 0),
    estimated_cost: roundCost(estimateCost(Number(row.input_tokens ?? 0), Number(row.output_tokens ?? 0))),
    task: row.task,
    summary: row.summary,
  }))
  return c.json({ sessions, period_days: days })
})

costAttributionRoutes.get('/by-tool', async (c) => {
  const userId = c.get('userId')
  const days = Math.min(Number(c.req.query('days')) || 30, 365)
  const tools = (await getCostByToolType(c.env.DB, userId, days)).map((row) => ({
    tool_name: row.tool_name,
    call_count: Number(row.call_count ?? 0),
    input_tokens: Number(row.input_tokens ?? 0),
    output_tokens: Number(row.output_tokens ?? 0),
    estimated_cost: roundCost(estimateCost(Number(row.input_tokens ?? 0), Number(row.output_tokens ?? 0))),
  }))
  return c.json({ tools, period_days: days })
})
