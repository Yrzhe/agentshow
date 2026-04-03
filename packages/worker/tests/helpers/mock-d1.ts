type ApiTokenRow = {
  id: string
  user_id: string
  name: string
  token_hash: string
  prefix: string
  last_used_at: string | null
}

type CloudSessionRow = {
  session_id: string
  user_id: string
  device_id: string
  pid: number
  cwd: string
  project_slug: string
  status: string
  started_at: string
  last_seen_at: string
  message_count: number
  total_input_tokens: number
  total_output_tokens: number
  tool_calls: number
  synced_at: string
  summary?: string | null
  task?: string | null
  files?: string | null
}

type CloudEventRow = {
  id: number
  user_id: string
  session_id: string
  local_id: number
  type: string
  role: string | null
  content_preview: string | null
  tool_name: string | null
  input_tokens: number
  output_tokens: number
  model: string | null
  timestamp: string
  synced_at: string
}

type CloudNoteRow = {
  id: number
  user_id: string
  device_id: string
  project_id: string
  project_slug: string | null
  key: string
  content: string
  session_id: string | null
  created_at: string
  updated_at: string
  synced_at: string
}

type WatermarkRow = {
  user_id: string
  device_id: string
  last_session_seen_at: string | null
  last_event_local_id: number
  updated_at: string
}

export class MockD1Database {
  private readonly apiTokens: ApiTokenRow[] = []
  private readonly cloudSessions: CloudSessionRow[] = []
  private readonly cloudEvents: CloudEventRow[] = []
  private readonly cloudNotes: CloudNoteRow[] = []
  private readonly syncWatermarks: WatermarkRow[] = []
  private nextEventId = 1
  private nextNoteId = 1

  prepare(sql: string): MockD1Statement {
    return new MockD1Statement(this, sql)
  }

  async batch(statements: MockD1Statement[]): Promise<unknown[]> {
    return Promise.all(statements.map((statement) => statement.run()))
  }

  seedToken(row: Omit<ApiTokenRow, 'last_used_at' | 'name'>): void {
    this.apiTokens.push({ ...row, name: 'default', last_used_at: null })
  }

  listSessions(): CloudSessionRow[] {
    return [...this.cloudSessions]
  }

  listEvents(): CloudEventRow[] {
    return [...this.cloudEvents]
  }

  execute(sql: string, params: unknown[], mode: 'run' | 'first' | 'all'): unknown {
    const normalized = sql.replace(/\s+/g, ' ').trim()

    if (normalized.startsWith('SELECT user_id FROM api_tokens')) {
      return this.apiTokens.find((row) => row.token_hash === params[0])
        ? { user_id: this.apiTokens.find((row) => row.token_hash === params[0])?.user_id }
        : null
    }
    if (normalized.startsWith('UPDATE api_tokens SET last_used_at')) {
      const row = this.apiTokens.find((token) => token.token_hash === params[0])
      if (row) row.last_used_at = now()
      return {}
    }
    if (normalized.startsWith('INSERT OR REPLACE INTO cloud_sessions')) {
      const [session_id, user_id, device_id, pid, cwd, project_slug, status, started_at, last_seen_at, message_count, total_input_tokens, total_output_tokens, tool_calls, task, files] = params
      const nextRow: CloudSessionRow = {
        session_id: String(session_id),
        user_id: String(user_id),
        device_id: String(device_id),
        pid: Number(pid),
        cwd: String(cwd),
        project_slug: String(project_slug),
        status: String(status),
        started_at: String(started_at),
        last_seen_at: String(last_seen_at),
        message_count: Number(message_count),
        total_input_tokens: Number(total_input_tokens),
        total_output_tokens: Number(total_output_tokens),
        tool_calls: Number(tool_calls),
        synced_at: now(),
        summary: null,
        task: task != null ? String(task) : null,
        files: files != null ? String(files) : null,
      }
      replaceByKey(this.cloudSessions, nextRow, (row) => row.user_id === nextRow.user_id && row.session_id === nextRow.session_id)
      return {}
    }
    if (normalized.startsWith('SELECT * FROM cloud_sessions WHERE user_id = ? AND session_id = ? LIMIT 1')) {
      return this.cloudSessions.find((row) => row.user_id === params[0] && row.session_id === params[1]) ?? null
    }
    if (normalized.startsWith('SELECT * FROM cloud_sessions WHERE')) {
      return { results: filterSessions(this.cloudSessions, normalized, params) }
    }
    if (normalized.startsWith('SELECT total_input_tokens, total_output_tokens, tool_calls, message_count FROM cloud_sessions')) {
      const row = this.cloudSessions.find((session) => session.user_id === params[0] && session.session_id === params[1])
      return row ? pickStats(row) : null
    }
    if (normalized.startsWith('INSERT INTO cloud_events')) {
      const [user_id, session_id, local_id, type, role, content_preview, tool_name, input_tokens, output_tokens, model, timestamp] = params
      this.cloudEvents.push({
        id: this.nextEventId++,
        user_id: String(user_id),
        session_id: String(session_id),
        local_id: Number(local_id),
        type: String(type),
        role: role ? String(role) : null,
        content_preview: content_preview ? String(content_preview) : null,
        tool_name: tool_name ? String(tool_name) : null,
        input_tokens: Number(input_tokens),
        output_tokens: Number(output_tokens),
        model: model ? String(model) : null,
        timestamp: String(timestamp),
        synced_at: now(),
      })
      return {}
    }
    if (normalized.startsWith('SELECT local_id, session_id, type, role, content_preview, tool_name,')) {
      const [userId, sessionId, limit] = params as [string, string, number]
      return {
        results: this.cloudEvents
          .filter((row) => row.user_id === userId && row.session_id === sessionId)
          .sort((left, right) => left.timestamp.localeCompare(right.timestamp) || left.local_id - right.local_id)
          .slice(0, Number(limit))
          .map((row) => ({
            local_id: row.local_id,
            session_id: row.session_id,
            type: row.type,
            role: row.role,
            content_preview: row.content_preview,
            tool_name: row.tool_name,
            input_tokens: row.input_tokens,
            output_tokens: row.output_tokens,
            model: row.model,
            timestamp: row.timestamp,
          })),
      }
    }
    if (normalized.startsWith('UPDATE cloud_sessions SET summary = ? WHERE session_id = ? AND user_id = ?')) {
      const row = this.cloudSessions.find((session) => session.session_id === params[1] && session.user_id === params[2])
      if (row) {
        row.summary = String(params[0])
      }
      return {}
    }
    if (normalized.startsWith('SELECT project_slug,')) {
      return { results: buildProjects(this.cloudSessions, String(params[0])) }
    }
    if (normalized.startsWith('SELECT last_session_seen_at, last_event_local_id FROM sync_watermarks')) {
      return this.syncWatermarks.find((row) => row.user_id === params[0] && row.device_id === params[1]) ?? null
    }
    if (normalized.startsWith('INSERT OR REPLACE INTO sync_watermarks')) {
      const [user_id, device_id, last_session_seen_at, last_event_local_id] = params
      const nextRow: WatermarkRow = {
        user_id: String(user_id),
        device_id: String(device_id),
        last_session_seen_at: last_session_seen_at ? String(last_session_seen_at) : null,
        last_event_local_id: Number(last_event_local_id),
        updated_at: now(),
      }
      replaceByKey(this.syncWatermarks, nextRow, (row) => row.user_id === nextRow.user_id && row.device_id === nextRow.device_id)
      return {}
    }
    if (normalized.startsWith('INSERT OR REPLACE INTO cloud_notes')) {
      const [user_id, device_id, project_id, project_slug, key, content, session_id, created_at, updated_at] = params
      const nextRow: CloudNoteRow = {
        id: this.nextNoteId++,
        user_id: String(user_id),
        device_id: String(device_id),
        project_id: String(project_id),
        project_slug: project_slug != null ? String(project_slug) : null,
        key: String(key),
        content: String(content),
        session_id: session_id != null ? String(session_id) : null,
        created_at: String(created_at),
        updated_at: String(updated_at),
        synced_at: now(),
      }
      replaceByKey(this.cloudNotes, nextRow, (row) => row.user_id === nextRow.user_id && row.project_id === nextRow.project_id && row.key === nextRow.key)
      return {}
    }
    if (normalized.startsWith('SELECT * FROM cloud_notes WHERE')) {
      let filtered = this.cloudNotes.filter((row) => row.user_id === String(params[0]))
      let cursor = 1
      if (normalized.includes('project_slug = ?')) {
        filtered = filtered.filter((row) => row.project_slug === String(params[cursor]))
        cursor++
      }
      if (normalized.includes('session_id = ?')) {
        filtered = filtered.filter((row) => row.session_id === String(params[cursor]))
        cursor++
      }
      const limit = Number(params[cursor] ?? 50)
      return {
        results: filtered
          .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
          .slice(0, limit),
      }
    }
    if (normalized.includes('date(started_at) AS date')) {
      // getTokensByDay mock: return empty array for now
      return { results: [] }
    }
    if (normalized.includes('SELECT (')) {
      // searchCloudEvents count with UNION — return simplified count
      const query = String(params[1])
      const eventCount = this.cloudEvents.filter((e) =>
        (e.content_preview && e.content_preview.includes(query)) ||
        (e.tool_name && e.tool_name.includes(query)),
      ).length
      const noteCount = this.cloudNotes.filter((n) =>
        n.user_id === String(params[5]) &&
        (n.key.includes(String(params[6])) || n.content.includes(String(params[7]))),
      ).length
      return { total: eventCount + noteCount }
    }
    if (normalized.includes('SELECT * FROM (')) {
      // searchCloudEvents UNION ALL query
      const userId = String(params[0])
      const query = String(params[1])
      const limit = Number(params[params.length - 2])
      const offset = Number(params[params.length - 1])
      const eventResults = this.cloudEvents
        .filter((e) => e.user_id === userId)
        .filter((e) =>
          (e.content_preview && e.content_preview.includes(query)) ||
          (e.tool_name && e.tool_name.includes(query)),
        )
        .map((e) => {
          const session = this.cloudSessions.find((s) => s.session_id === e.session_id && s.user_id === e.user_id)
          return {
            local_id: e.local_id,
            session_id: e.session_id,
            type: e.type,
            role: e.role,
            content_preview: e.content_preview,
            tool_name: e.tool_name,
            model: e.model,
            timestamp: e.timestamp,
            input_tokens: e.input_tokens,
            output_tokens: e.output_tokens,
            cwd: session?.cwd ?? '',
            project_slug: session?.project_slug ?? '',
            session_status: session?.status ?? '',
            source_type: 'event' as const,
          }
        })
      const noteUserId = String(params[5])
      const noteQuery = String(params[6])
      const noteResults = this.cloudNotes
        .filter((n) => n.user_id === noteUserId)
        .filter((n) => n.key.includes(noteQuery) || n.content.includes(noteQuery))
        .map((n) => ({
          local_id: n.id,
          session_id: n.session_id ?? '',
          type: 'note' as const,
          role: null,
          content_preview: n.content,
          tool_name: n.key,
          model: null,
          timestamp: n.updated_at,
          input_tokens: 0,
          output_tokens: 0,
          cwd: '',
          project_slug: n.project_slug ?? n.project_id,
          session_status: '',
          source_type: 'note' as const,
        }))
      const combined = [...eventResults, ...noteResults]
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
        .slice(offset, offset + limit)
      return { results: combined }
    }

    throw new Error(`Unhandled SQL in mock D1: ${normalized}`)
  }
}

class MockD1Statement {
  private params: unknown[] = []

  constructor(
    private readonly db: MockD1Database,
    private readonly sql: string,
  ) {}

  bind(...params: unknown[]): MockD1Statement {
    this.params = params
    return this
  }

  async run(): Promise<unknown> {
    return this.db.execute(this.sql, this.params, 'run')
  }

  async first<T>(): Promise<T | null> {
    return this.db.execute(this.sql, this.params, 'first') as T | null
  }

  async all<T>(): Promise<{ results: T[] }> {
    return this.db.execute(this.sql, this.params, 'all') as { results: T[] }
  }
}

function filterSessions(rows: CloudSessionRow[], sql: string, params: unknown[]): CloudSessionRow[] {
  let cursor = 1
  let filtered = rows.filter((row) => row.user_id === String(params[0]))
  if (sql.includes('status = ?')) {
    const status = String(params[cursor++])
    filtered = filtered.filter((row) => row.status === status)
  }
  if (sql.includes('project_slug = ?')) {
    const projectSlug = String(params[cursor++])
    filtered = filtered.filter((row) => row.project_slug === projectSlug)
  }
  const limit = Number(params[cursor++])
  const offset = Number(params[cursor])
  return filtered
    .sort((left, right) => right.last_seen_at.localeCompare(left.last_seen_at) || left.session_id.localeCompare(right.session_id))
    .slice(offset, offset + limit)
}

function buildProjects(rows: CloudSessionRow[], userId: string) {
  const groups = new Map<string, CloudSessionRow[]>()
  for (const row of rows.filter((session) => session.user_id === userId)) {
    groups.set(row.project_slug, [...(groups.get(row.project_slug) ?? []), row])
  }
  return [...groups.entries()]
    .map(([project_slug, group]) => ({
      project_slug,
      cwd: group[0]?.cwd ?? '',
      active_sessions: group.filter((row) => row.status === 'active').length,
      total_sessions: group.length,
      total_input_tokens: group.reduce((sum, row) => sum + row.total_input_tokens, 0),
      total_output_tokens: group.reduce((sum, row) => sum + row.total_output_tokens, 0),
      total_tool_calls: group.reduce((sum, row) => sum + row.tool_calls, 0),
      last_activity: group.reduce((latest, row) => latest > row.last_seen_at ? latest : row.last_seen_at, ''),
    }))
    .sort((left, right) => right.last_activity.localeCompare(left.last_activity) || left.project_slug.localeCompare(right.project_slug))
}

function pickStats(row: CloudSessionRow) {
  return {
    total_input_tokens: row.total_input_tokens,
    total_output_tokens: row.total_output_tokens,
    tool_calls: row.tool_calls,
    message_count: row.message_count,
  }
}

function replaceByKey<T>(rows: T[], nextRow: T, matcher: (row: T) => boolean): void {
  const index = rows.findIndex(matcher)
  if (index >= 0) rows[index] = nextRow
  else rows.push(nextRow)
}

function now(): string {
  return new Date().toISOString()
}
