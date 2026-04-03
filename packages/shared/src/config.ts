import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { nanoid } from 'nanoid'
import { DB_DIR, CONFIG_FILE, DEFAULT_PRIVACY_LEVEL, ID_LENGTH } from './constants.js'
import type { AgentShowConfig, PrivacyLevel } from './types.js'

const DEVICE_ID_PREFIX = 'dev_'

export function getDefaultConfig(): AgentShowConfig {
  return {
    device_id: `${DEVICE_ID_PREFIX}${nanoid(ID_LENGTH)}`,
    cloud: {
      url: null,
      token: null,
    },
    privacy: {
      level: DEFAULT_PRIVACY_LEVEL as PrivacyLevel,
    },
  }
}

export function getConfigPath(configDir?: string): string {
  const dir = configDir ?? join(homedir(), DB_DIR)
  return join(dir, CONFIG_FILE)
}

export function readConfig(configDir?: string): AgentShowConfig {
  const configPath = getConfigPath(configDir)

  if (!existsSync(configPath)) {
    return getDefaultConfig()
  }

  try {
    const raw = JSON.parse(readFileSync(configPath, 'utf8'))
    const defaults = getDefaultConfig()

    return {
      device_id: typeof raw.device_id === 'string' ? raw.device_id : defaults.device_id,
      cloud: {
        url: raw.cloud?.url ?? null,
        token: raw.cloud?.token ?? null,
      },
      privacy: {
        level: isValidPrivacyLevel(raw.privacy?.level) ? raw.privacy.level : defaults.privacy.level,
      },
    }
  } catch {
    return getDefaultConfig()
  }
}

export function writeConfig(config: AgentShowConfig, configDir?: string): void {
  const configPath = getConfigPath(configDir)
  mkdirSync(dirname(configPath), { recursive: true })
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8')
}

function isValidPrivacyLevel(value: unknown): value is PrivacyLevel {
  return value === 0 || value === 1 || value === 2 || value === 3
}
