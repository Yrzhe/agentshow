import { Hono } from 'hono'
import { getTokensByDay } from '../db/queries.js'
import type { AppType } from '../index.js'
import { flexAuth } from '../middleware/auth.js'

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-6': { input: 15, output: 75 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 0.8, output: 4 },
}

const DEFAULT_PRICING = { input: 3, output: 15 }

export function estimateCost(inputTokens: number, outputTokens: number, model?: string | null): number {
  const pricing = (model ? MODEL_PRICING[model] : undefined) ?? DEFAULT_PRICING
  return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output
}

export const usageDailyRoutes = new Hono<AppType>()
usageDailyRoutes.use('*', flexAuth())

usageDailyRoutes.get('/daily', async (c) => {
  const userId = c.get('userId')
  const days = Math.min(Number(c.req.query('days')) || 14, 90)
  const data = await getTokensByDay(c.env.DB, userId, days)
  const withCost = data.map((d) => ({
    ...d,
    estimated_cost: Math.round(estimateCost(d.input_tokens, d.output_tokens) * 10000) / 10000,
  }))
  return c.json({ daily: withCost, pricing: MODEL_PRICING })
})

usageDailyRoutes.get('/cost', async (c) => {
  const userId = c.get('userId')
  const days = Math.min(Number(c.req.query('days')) || 30, 365)
  const data = await getTokensByDay(c.env.DB, userId, days)
  const totalInput = data.reduce((sum, d) => sum + d.input_tokens, 0)
  const totalOutput = data.reduce((sum, d) => sum + d.output_tokens, 0)
  const totalCost = estimateCost(totalInput, totalOutput)
  const dailyCosts = data.map((d) => ({
    date: d.date,
    cost: Math.round(estimateCost(d.input_tokens, d.output_tokens) * 10000) / 10000,
  }))
  return c.json({
    period_days: days,
    total_input_tokens: totalInput,
    total_output_tokens: totalOutput,
    estimated_total_cost: Math.round(totalCost * 100) / 100,
    daily: dailyCosts,
    pricing: MODEL_PRICING,
  })
})
