import { Hono } from 'hono'
import {
  deleteBudgetSetting,
  getBudgetSettings,
  getTokensByDay,
  upsertBudgetSetting,
} from '../db/queries.js'
import { flexAuth, type ServerAppType } from '../middleware/auth.js'
import { estimateCost } from './usage.js'

type BudgetType = 'daily' | 'monthly'

type BudgetPayload = {
  budget_type?: string
  limit_usd?: number
  alert_threshold?: number
}

type ValidBudgetPayload = {
  budget_type: BudgetType
  limit_usd: number
  alert_threshold: number
}

function getMonthRange(): { prefix: string; days: number } {
  const now = new Date()
  const year = now.getUTCFullYear()
  const month = String(now.getUTCMonth() + 1).padStart(2, '0')
  return { prefix: `${year}-${month}`, days: now.getUTCDate() }
}

function getUsageCost(
  rows: Array<{ date: string; input_tokens: number; output_tokens: number }>,
  budgetType: BudgetType,
): number {
  const today = new Date().toISOString().slice(0, 10)
  const month = getMonthRange()
  const filtered = rows.filter((row) =>
    budgetType === 'daily' ? row.date === today : row.date.startsWith(month.prefix),
  )
  return filtered.reduce((sum, row) => sum + estimateCost(row.input_tokens, row.output_tokens), 0)
}

function validatePayload(payload: BudgetPayload): { ok: true; value: ValidBudgetPayload } | Response {
  const budgetType = payload.budget_type
  const limitUsd = Number(payload.limit_usd)
  const alertThreshold = Number(payload.alert_threshold)
  if (budgetType !== 'daily' && budgetType !== 'monthly') {
    return Response.json({ error: 'Invalid budget_type' }, { status: 400 })
  }
  if (!Number.isFinite(limitUsd) || limitUsd <= 0) {
    return Response.json({ error: 'Invalid limit_usd' }, { status: 400 })
  }
  if (!Number.isFinite(alertThreshold) || alertThreshold <= 0 || alertThreshold > 1) {
    return Response.json({ error: 'Invalid alert_threshold' }, { status: 400 })
  }
  return { ok: true, value: { budget_type: budgetType, limit_usd: limitUsd, alert_threshold: alertThreshold } }
}

export const budgetRoutes = new Hono<ServerAppType>()
budgetRoutes.use('*', flexAuth())

budgetRoutes.get('/', async (c) => {
  const userId = c.get('userId')
  const db = c.get('db')
  const settings = getBudgetSettings(db, userId)
  const month = getMonthRange()
  const rows = getTokensByDay(db, userId, Math.max(1, month.days))
  const budgets = settings.map((setting) => {
    const currentUsage = getUsageCost(rows, setting.budget_type)
    const usagePercent = setting.limit_usd > 0 ? (currentUsage / setting.limit_usd) * 100 : 0
    return {
      ...setting,
      current_usage_usd: Math.round(currentUsage * 100) / 100,
      usage_percent: Math.round(usagePercent * 10) / 10,
      is_over_threshold: currentUsage >= setting.limit_usd * setting.alert_threshold,
      is_over_limit: currentUsage >= setting.limit_usd,
    }
  })
  return c.json({ budgets })
})

budgetRoutes.put('/', async (c) => {
  const payload = await c.req.json<BudgetPayload>()
  const parsed = validatePayload(payload)
  if (parsed instanceof Response) {
    return parsed
  }
  const { budget_type, limit_usd, alert_threshold } = parsed.value
  upsertBudgetSetting(c.get('db'), c.get('userId'), budget_type, limit_usd, alert_threshold)
  return c.json({ status: 'ok' })
})

budgetRoutes.delete('/:type', async (c) => {
  const value = c.req.param('type')
  if (value !== 'daily' && value !== 'monthly') {
    return c.json({ error: 'Invalid budget_type' }, 400)
  }
  const budgetType: BudgetType = value
  deleteBudgetSetting(c.get('db'), c.get('userId'), budgetType)
  return c.json({ status: 'ok' })
})
