import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PROJECT_IDENTITY_FILE } from '@agentshow/shared'
import { detectProject } from '../src/project/detect.js'

const tempDirs: string[] = []

function createTempDir(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `agentshow-project-${name}-`))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (!dir) {
      continue
    }

    rmSync(dir, { recursive: true, force: true })
  }
})

describe('project detection', () => {
  it('creates a new identity in an empty directory without git', () => {
    const root = createTempDir('no-git')

    const result = detectProject(root)
    const identityPath = join(root, PROJECT_IDENTITY_FILE)
    const identity = JSON.parse(readFileSync(identityPath, 'utf8')) as {
      id: string
      name: string
    }

    expect(result.created).toBe(true)
    expect(result.root).toBe(root)
    expect(result.name).toBe(root.split('/').pop())
    expect(identity.id).toBe(result.id)
    expect(identity.name).toBe(result.name)
  })

  it('creates the identity at the git root', () => {
    const root = createTempDir('git-root')
    const deepDir = join(root, 'src', 'deep')
    mkdirSync(join(root, '.git'))
    mkdirSync(deepDir, { recursive: true })

    const result = detectProject(deepDir)

    expect(result.root).toBe(root)
    expect(existsSync(join(root, PROJECT_IDENTITY_FILE))).toBe(true)
    expect(existsSync(join(deepDir, PROJECT_IDENTITY_FILE))).toBe(false)
  })

  it('finds an existing identity from a nested child directory', () => {
    const root = createTempDir('nested')
    const nestedDir = join(root, 'src', 'deep')
    mkdirSync(nestedDir, { recursive: true })
    writeFileSync(
      join(root, PROJECT_IDENTITY_FILE),
      JSON.stringify({ id: 'proj_existing', name: 'existing-project' }),
      'utf8',
    )

    const result = detectProject(nestedDir)

    expect(result).toEqual({
      id: 'proj_existing',
      name: 'existing-project',
      root,
      created: false,
    })
  })

  it('reuses an existing identity without creating a new one', () => {
    const root = createTempDir('repeat')
    const identityPath = join(root, PROJECT_IDENTITY_FILE)
    writeFileSync(
      identityPath,
      JSON.stringify({ id: 'proj_repeat', name: 'repeat-project' }),
      'utf8',
    )

    const firstContent = readFileSync(identityPath, 'utf8')
    const result = detectProject(root)
    const secondContent = readFileSync(identityPath, 'utf8')

    expect(result.created).toBe(false)
    expect(result.id).toBe('proj_repeat')
    expect(firstContent).toBe(secondContent)
  })

  it('prefers package.json name over directory name', () => {
    const root = createTempDir('package-name')
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'agentshow-test-project' }, null, 2),
      'utf8',
    )

    const result = detectProject(root)

    expect(result.name).toBe('agentshow-test-project')
  })

  it('appends the identity file to .gitignore when missing', () => {
    const root = createTempDir('gitignore-append')
    writeFileSync(join(root, '.gitignore'), 'node_modules/\n', 'utf8')

    detectProject(root)

    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toBe(
      `node_modules/\n${PROJECT_IDENTITY_FILE}\n`,
    )
  })

  it('does not duplicate the identity line in .gitignore', () => {
    const root = createTempDir('gitignore-existing')
    writeFileSync(
      join(root, '.gitignore'),
      `node_modules/\n${PROJECT_IDENTITY_FILE}\n`,
      'utf8',
    )

    detectProject(root)

    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toBe(
      `node_modules/\n${PROJECT_IDENTITY_FILE}\n`,
    )
  })

  it('does not create a .gitignore file when one does not exist', () => {
    const root = createTempDir('no-gitignore')

    detectProject(root)

    expect(existsSync(join(root, '.gitignore'))).toBe(false)
  })
})
