import { serve } from '@hono/node-server'
import { app } from './app.js'

const port = Number(process.env.PORT ?? 3000)

console.log(`AgentShow server starting on port ${port}...`)
serve({ fetch: app.fetch, port }, () => {
  console.log(`AgentShow server running on http://localhost:${port}`)
})
