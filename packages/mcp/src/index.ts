import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { getDb } from './db/connection.js'
import { createAgentShowServer } from './server.js'

async function main(): Promise<void> {
  const db = getDb()
  const server = createAgentShowServer(db)
  const transport = new StdioServerTransport()

  await server.connect(transport)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
