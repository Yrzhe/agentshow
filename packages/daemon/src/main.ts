#!/usr/bin/env node
import { homedir } from 'node:os'
import { join } from 'node:path'
import { CLAUDE_DIR, DAEMON_HTTP_PORT } from '@agentshow/shared'
import { getDaemonDb } from './db/connection.js'
import { createApiServer } from './api/server.js'
import { CloudSync } from './sync/cloud-sync.js'
import { SessionTracker } from './tracker/session-tracker.js'

const claudeDir = join(homedir(), CLAUDE_DIR)
const port = DAEMON_HTTP_PORT

const db = getDaemonDb()
const tracker = new SessionTracker(db, claudeDir)
const cloudSync = new CloudSync(db)
const server = createApiServer(db, port)

tracker.start()
cloudSync.start()
server.listen(port, () => {
  console.log(`agentshow-daemon listening on 127.0.0.1:${port}`)
  console.log(`monitoring ${claudeDir}`)
})

function shutdown(): void {
  console.log('shutting down...')
  tracker.stop()
  cloudSync.stop()
  server.close()
  db.close()
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
