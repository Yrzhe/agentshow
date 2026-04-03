import type Database from 'better-sqlite3'
import http from 'node:http'
import { DAEMON_HTTP_PORT } from '@agentshow/shared'
import { handleApiRequest } from './routes.js'

const LOCAL_HOST = '127.0.0.1'

export function createApiServer(db: Database.Database, port = DAEMON_HTTP_PORT): http.Server {
  const server = http.createServer((req, res) => {
    handleApiRequest(db, req, res)
  })

  const originalListen = server.listen.bind(server)

  server.listen = ((...args: Parameters<http.Server['listen']>) => {
    if (args.length === 0) {
      return originalListen(port, LOCAL_HOST)
    }

    const [first, second, third] = args

    if (typeof first === 'number') {
      if (typeof second === 'function') {
        return originalListen(first, LOCAL_HOST, second)
      }

      if (second === undefined) {
        return originalListen(first, LOCAL_HOST)
      }
    }

    if (typeof first === 'object' && first !== null && !('path' in first)) {
      return originalListen({ ...first, host: first.host ?? LOCAL_HOST }, second)
    }

    return originalListen(...args)
  }) as http.Server['listen']

  return server
}
