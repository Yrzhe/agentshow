import { nanoid } from 'nanoid'
import { PROJECT_ID_PREFIX, SESSION_ID_PREFIX, ID_LENGTH } from './constants.js'

export function generateProjectId(): string {
  return `${PROJECT_ID_PREFIX}${nanoid(ID_LENGTH)}`
}

export function generateSessionId(): string {
  return `${SESSION_ID_PREFIX}${nanoid(ID_LENGTH)}`
}
