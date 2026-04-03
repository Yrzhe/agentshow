export type CloudSessionStatus = 'discovered' | 'active' | 'ended'

export interface SyncSession {
  session_id: string
  pid: number
  cwd: string
  project_slug: string
  status: CloudSessionStatus
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

export interface CloudSession {
  session_id: string
  user_id: string
  device_id: string
  pid: number
  cwd: string
  project_slug: string
  status: CloudSessionStatus
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

export interface CurrentUser {
  user_id: string
  email: string | null
  github_login: string | null
  github_avatar_url: string | null
}
