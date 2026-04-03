// ============================================================
// .agentshow.json — 项目身份文件
// ============================================================
export interface ProjectIdentity {
  /** 项目唯一 ID，如 "proj_a7x9k2" */
  id: string
  /** 项目显示名，如 "pagefly" */
  name: string
}

// ============================================================
// Database Records
// ============================================================
export interface SessionRecord {
  id: string
  project_id: string
  project_name: string
  cwd: string
  task: string | null
  files: string | null          // JSON array string
  conversation_path: string | null
  status: 'active' | 'inactive'
  started_at: string
  last_heartbeat: string
}

export interface NoteRecord {
  id: number
  project_id: string
  session_id: string | null
  key: string
  content: string
  created_at: string
  updated_at: string
}

export interface SessionHistoryRecord {
  id: string
  project_id: string
  project_name: string
  task: string | null
  summary: string | null
  conversation_path: string | null
  started_at: string
  ended_at: string
}

// ============================================================
// Tool Inputs
// ============================================================
export interface RegisterStatusInput {
  /** Agent 的工作目录（首次必传，后续可省略） */
  cwd?: string
  /** 当前任务描述 */
  task?: string
  /** 正在操作的文件列表 */
  files?: string[]
}

export interface GetPeersInput {
  /** "all" 返回所有 project 摘要，省略则返回同 project 详情 */
  scope?: 'all'
  /** 跨 project 查询指定项目名 */
  project?: string
}

export interface ShareNoteInput {
  /** Note 的唯一标识 key（同 project 下唯一） */
  key: string
  /** Note 内容 */
  content: string
}

export interface GetNotesInput {
  /** 跨 project 查询 */
  project?: string
  /** 按时间过滤（ISO 8601） */
  since?: string
  /** 关键词搜索（匹配 key + content） */
  search?: string
}

export interface DeleteNoteInput {
  /** 要删除的 note key */
  key: string
}

export interface GetProjectHistoryInput {
  /** 指定 project（默认当前 project） */
  project?: string
  /** 按时间过滤 */
  since?: string
  /** 关键词搜索 */
  search?: string
}

// ============================================================
// Tool Outputs
// ============================================================
export interface RegisterStatusOutput {
  session_id: string
  project_id: string
  project_name: string
  status: 'registered' | 'updated'
}

export interface PeerInfo {
  session_id: string
  task: string | null
  files: string[]
  started_at: string
  last_heartbeat: string
}

export interface GetPeersOutput {
  project: string
  peers: PeerInfo[]
  notes_count: number
}

export interface GetPeersAllOutput {
  projects: Array<{
    project_id: string
    name: string
    active_sessions: number
    notes_count: number
  }>
}

export interface NoteInfo {
  id: number
  key: string
  content: string
  session_id: string | null
  created_at: string
  updated_at: string
}

export interface GetNotesOutput {
  project: string
  notes: NoteInfo[]
}

export interface ShareNoteOutput {
  id: number
  key: string
  status: 'created' | 'updated'
}

export interface DeleteNoteOutput {
  status: 'deleted' | 'not_found'
}

export interface GetProjectHistoryOutput {
  project: string
  sessions: Array<{
    id: string
    task: string | null
    summary: string | null
    started_at: string
    ended_at: string
  }>
  notes: NoteInfo[]
}

// ============================================================
// Daemon Types
// ============================================================

/** Claude Code 原生 session 元数据 (~/.claude/sessions/{pid}.json) */
export interface ClaudeSessionMeta {
  pid: number
  sessionId: string
  cwd: string
  startedAt: number
  kind: string
  entrypoint: string
  name?: string
}

/** JSONL 对话事件中的 token 用量 */
export interface TokenUsage {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
}

/** JSONL 单行事件 (~/.claude/projects/{slug}/{uuid}.jsonl) */
export interface ConversationEvent {
  type: string
  uuid?: string
  parentUuid?: string | null
  timestamp?: string
  sessionId?: string
  cwd?: string
  version?: string
  gitBranch?: string
  message?: {
    role?: string
    content?: unknown
    usage?: TokenUsage
    model?: string
    id?: string
  }
}

/** Daemon session 状态 */
export type DaemonSessionStatus = 'discovered' | 'active' | 'ended'

/** Daemon 追踪的 session 记录 */
export interface DaemonSession {
  session_id: string
  pid: number
  cwd: string
  project_slug: string
  status: DaemonSessionStatus
  started_at: string
  last_seen_at: string
  conversation_path: string | null
  message_count: number
  total_input_tokens: number
  total_output_tokens: number
  tool_calls: number
}

/** 提取后的对话事件记录 */
export interface MessageRecord {
  id: number
  session_id: string
  type: string
  role: string | null
  content_preview: string | null
  tool_name: string | null
  input_tokens: number
  output_tokens: number
  model: string | null
  timestamp: string
}

// ============================================================
// Cloud Config Types
// ============================================================

/** 隐私上传级别 */
export type PrivacyLevel = 0 | 1 | 2 | 3

export interface CloudConfig {
  url: string | null
  token: string | null
}

export interface AgentShowConfig {
  device_id: string
  cloud: CloudConfig
  privacy: {
    level: PrivacyLevel
  }
}

// ============================================================
// Sync Protocol Types
// ============================================================

export interface SyncPayload {
  device_id: string
  synced_at: string
  sessions: SyncSession[]
  events: SyncEvent[]
}

export interface SyncSession {
  session_id: string
  pid: number
  cwd: string
  project_slug: string
  status: DaemonSessionStatus
  started_at: string
  last_seen_at: string
  message_count: number
  total_input_tokens: number
  total_output_tokens: number
  tool_calls: number
  conversation_path?: string | null
}

export interface SyncEvent {
  local_id: number
  session_id: string
  type: string
  role: string | null
  tool_name: string | null
  input_tokens: number
  output_tokens: number
  model: string | null
  timestamp: string
  content_preview?: string | null
}

export interface SyncResponse {
  status: 'ok' | 'error'
  accepted_sessions: number
  accepted_events: number
  server_time: string
}

// ============================================================
// Cloud API Types
// ============================================================

export interface CloudSession {
  session_id: string
  device_id: string
  pid: number
  cwd: string
  project_slug: string
  status: DaemonSessionStatus
  started_at: string
  last_seen_at: string
  message_count: number
  total_input_tokens: number
  total_output_tokens: number
  tool_calls: number
  synced_at: string
}

export interface CloudProject {
  project_slug: string
  cwd: string
  active_sessions: number
  total_sessions: number
  total_input_tokens: number
  total_output_tokens: number
  total_tool_calls: number
  last_activity: string
}

export interface ApiToken {
  id: string
  name: string
  prefix: string
  created_at: string
  last_used_at: string | null
}
