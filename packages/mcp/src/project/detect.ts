import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import {
  generateProjectId,
  PROJECT_IDENTITY_FILE,
  type ProjectIdentity,
} from '@agentshow/shared'

export interface ProjectDetectResult {
  id: string
  name: string
  root: string
  created: boolean
}

export function detectProject(cwd: string): ProjectDetectResult {
  const resolvedCwd = resolve(cwd)
  const identityPath = findFileUpwards(resolvedCwd, PROJECT_IDENTITY_FILE)

  if (identityPath) {
    const identity = JSON.parse(
      readFileSync(identityPath, 'utf8'),
    ) as ProjectIdentity

    return {
      id: identity.id,
      name: identity.name,
      root: dirname(identityPath),
      created: false,
    }
  }

  const root = findProjectRoot(resolvedCwd)
  const name = inferProjectName(root)
  const identity: ProjectIdentity = {
    id: generateProjectId(),
    name,
  }
  const newIdentityPath = join(root, PROJECT_IDENTITY_FILE)

  writeFileSync(newIdentityPath, `${JSON.stringify(identity, null, 2)}\n`, 'utf8')
  ensureGitignore(root, PROJECT_IDENTITY_FILE)

  return {
    id: identity.id,
    name: identity.name,
    root,
    created: true,
  }
}

function findFileUpwards(startDir: string, fileName: string): string | null {
  let currentDir = resolve(startDir)

  while (true) {
    const candidate = join(currentDir, fileName)

    if (existsSync(candidate)) {
      return candidate
    }

    const parentDir = dirname(currentDir)
    if (parentDir === currentDir) {
      return null
    }

    currentDir = parentDir
  }
}

function findProjectRoot(cwd: string): string {
  const gitPath = findFileUpwards(cwd, '.git')

  if (gitPath) {
    return dirname(gitPath)
  }

  return resolve(cwd)
}

function inferProjectName(root: string): string {
  const packageJsonPath = join(root, 'package.json')

  if (existsSync(packageJsonPath)) {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      name?: unknown
    }

    if (typeof packageJson.name === 'string' && packageJson.name.length > 0) {
      return packageJson.name
    }
  }

  return basename(root)
}

function ensureGitignore(root: string, line: string): void {
  const gitignorePath = join(root, '.gitignore')

  if (!existsSync(gitignorePath)) {
    return
  }

  const existingContent = readFileSync(gitignorePath, 'utf8')
  const lines = existingContent.split(/\r?\n/)

  if (lines.includes(line)) {
    return
  }

  const separator = existingContent.length === 0 || existingContent.endsWith('\n')
    ? ''
    : '\n'

  writeFileSync(gitignorePath, `${existingContent}${separator}${line}\n`, 'utf8')
}
