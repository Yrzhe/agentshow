/** ID 前缀 */
export const PROJECT_ID_PREFIX = 'proj_'
export const SESSION_ID_PREFIX = 'ses_'

/** nanoid 长度（不含前缀） */
export const ID_LENGTH = 8

/** 项目身份文件名 */
export const PROJECT_IDENTITY_FILE = '.agentshow.json'

/** 数据库文件路径 */
export const DB_DIR = '.agentshow'
export const DB_FILE = 'agentshow.db'

/** Session 超时时间（毫秒） */
export const SESSION_TIMEOUT_MS = 2 * 60 * 60 * 1000  // 2 小时

/** AgentShow 数据库 schema 版本 */
export const SCHEMA_VERSION = 1

// ============================================================
// Daemon Constants
// ============================================================

/** Claude Code 目录名 */
export const CLAUDE_DIR = '.claude'
export const CLAUDE_SESSIONS_DIR = 'sessions'
export const CLAUDE_PROJECTS_DIR = 'projects'

/** Daemon 轮询间隔（毫秒） */
export const DAEMON_POLL_INTERVAL_MS = 5_000

/** PID 存活检查间隔（毫秒） */
export const PID_CHECK_INTERVAL_MS = 30_000

/** Daemon HTTP API 端口 */
export const DAEMON_HTTP_PORT = 45677

// ============================================================
// Cloud Constants
// ============================================================

/** 云端同步间隔（毫秒） */
export const CLOUD_SYNC_INTERVAL_MS = 30_000

/** 配置文件名 */
export const CONFIG_FILE = 'config.json'

/** 默认隐私级别 */
export const DEFAULT_PRIVACY_LEVEL = 0 as const

/** API Token 前缀 */
export const API_TOKEN_PREFIX = 'as_'

/** API Token 随机部分长度 */
export const API_TOKEN_LENGTH = 32

/** 同步批量大小 */
export const SYNC_BATCH_SIZE = 100
