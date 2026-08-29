// Reads the workspace's implementation log and issue trackers, and routes every
// write back through the scripts that own them.
//
// `docs/implementation/NOTES.md` is append-only and `issues_*.json` carries an
// audit history; both are maintained exclusively by workspace-layout's Python
// scripts, which assign ids, stamp history rows and re-render the offline HTML
// viewer. So this module reads the files directly (they are already structured,
// and `issues.py list` only prints for humans) but never writes one — mutations
// shell out to the same CLI an agent would call, which keeps a single writer.

const IMPL = 'docs/implementation'
const SCRIPTS = `${process.env.HOME}/.claude/skills/workspace-layout/scripts`

export type NoteType =
  | 'design-decision' | 'deviation' | 'tradeoff' | 'open-question' | 'resolution'

export type Note = {
  ts: string
  type: NoteType
  author: string
  title: string
  body: string
  truncated: boolean
  /** Timestamp of the open-question a resolution closes, when it names one. */
  resolves?: string
  /** open-question only: set once some resolution names this entry. */
  answeredBy?: string
}

export type Issue = {
  id: string; num: number; title: string; severity: string; status: string
  owner: string; batch: string; evidence: string; body: string
  created: string; updated: string
  history: { ts: string; author: string; change: string }[]
}

export type Project = { project: string; prefix: string; issues: Issue[] }

const HEADER = /^## \[([^\]]+)\] · ([a-z-]+) · (.+)$/m
const RESOLVES = /^Resolves: \[([^\]]+)\]/m
const BODY_CAP = 1200

/** Trim to the preview cap without splitting a surrogate pair into a lone half. */
function capBody(s: string): string {
  if (s.length <= BODY_CAP) return s
  const last = s.charCodeAt(BODY_CAP - 1)
  const end = last >= 0xd800 && last <= 0xdbff ? BODY_CAP - 1 : BODY_CAP
  return s.slice(0, end)
}

function parseNotes(raw: string): Note[] {
  const out: Note[] = []
  for (const block of raw.split(/\n(?=## \[)/)) {
    const m = block.match(HEADER)
    if (!m) continue
    let rest = block.slice(block.indexOf('\n') + 1).trim()
    let title = ''
    const tm = rest.match(/^\*\*(.+?)\*\*\s*\n?/)
    if (tm) { title = tm[1]; rest = rest.slice(tm[0].length) }
    rest = rest.replace(/\n?---\s*$/, '').trim()
    const rm = rest.match(RESOLVES)
    const body = capBody(rest)
    out.push({
      ts: m[1], type: m[2] as NoteType, author: m[3], title,
      body, truncated: rest.length > BODY_CAP,
      ...(rm ? { resolves: rm[1] } : {}),
    })
  }
  return out
}

/** Mark every open-question that a later resolution names. */
function linkAnswers(notes: Note[]): Note[] {
  const answered = new Map<string, string>()
  for (const n of notes) if (n.type === 'resolution' && n.resolves) answered.set(n.resolves, n.ts)
  return notes.map(n =>
    n.type === 'open-question' && answered.has(n.ts)
      ? { ...n, answeredBy: answered.get(n.ts) }
      : n)
}

export async function loadNotes(offset = 0, limit = 80) {
  const f = Bun.file(`${IMPL}/NOTES.md`)
  if (!(await f.exists())) return { notes: [], total: 0, unanswered: [] as Note[] }
  const all = linkAnswers(parseNotes(await f.text()))
  // Newest first — the log is chronological, the reader is not.
  const ordered = [...all].reverse()
  const unanswered = ordered.filter(n => n.type === 'open-question' && !n.answeredBy)
  return { notes: ordered.slice(offset, offset + limit), total: ordered.length, unanswered }
}

export async function loadIssues(): Promise<Project[]> {
  const out: Project[] = []
  const glob = new Bun.Glob('issues_*.json')
  for await (const rel of glob.scan({ cwd: IMPL })) {
    try {
      const d = await Bun.file(`${IMPL}/${rel}`).json()
      out.push({ project: d.project ?? rel, prefix: d.prefix ?? '', issues: d.issues ?? [] })
    } catch {
      // A tracker mid-write or hand-corrupted must not blank the whole board.
    }
  }
  return out.sort((a, b) => a.project.localeCompare(b.project))
}

async function runScript(script: string, args: string[]) {
  // `python3` from PATH first: the moi server may run with a trimmed PATH, so
  // fall back to the known Homebrew interpreter rather than failing opaquely.
  for (const bin of ['python3', '/opt/homebrew/bin/python3']) {
    const p = Bun.spawn([bin, `${SCRIPTS}/${script}`, ...args], {
      cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe',
    })
    const [code, stdout, stderr] = await Promise.all([
      p.exited, new Response(p.stdout).text(), new Response(p.stderr).text(),
    ])
    if (code === 0) return { ok: true as const, out: stdout.trim() }
    // ENOENT surfaces as a non-zero exit with an empty stderr; a real script
    // error always says something, so only the silent case is worth retrying.
    if (stderr.trim()) return { ok: false as const, error: stderr.trim().split('\n').pop()! }
  }
  return { ok: false as const, error: 'python3 not found — cannot reach the notes scripts' }
}

export async function setIssueStatus(project: string, id: string, status: string, author: string) {
  return runScript('issues.py',
    ['--workspace', '.', '--project', project, '--author', author, 'set', id, '--status', status])
}

export async function setIssueSeverity(project: string, id: string, severity: string, author: string) {
  return runScript('issues.py',
    ['--workspace', '.', '--project', project, '--author', author, 'set', id, '--severity', severity])
}
