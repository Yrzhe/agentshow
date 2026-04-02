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
