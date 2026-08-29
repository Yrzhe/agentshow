// Implementation board — the live face of docs/implementation.
//
// Left: the append-only decision log, unanswered questions first. Right: one
// kanban per project. Mechanical edits (status, severity) go straight to the
// scripts; anything needing wording or judgement is handed to the agent.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { sendChatMessage } from 'moi'
import {
  IconRefresh, IconMessage2, IconChevronRight, IconAlertCircle, IconInbox,
} from '@tabler/icons-react'
import { getBoard, moveIssue, rankIssue } from './board.server'
import type { Note, NoteType, Issue, Project } from '../lib/board-data'

export const config = { title: 'Implementation board', icon: 'activity' } as const

function cx(...c: (string | false | undefined | null)[]) { return c.filter(Boolean).join(' ') }

// The five entry types the notes protocol defines. Colour repeats the mapping
// the offline viewer already uses, so the two never disagree; the chip row
// doubles as its legend, so colour is never the only carrier.
const TYPES: { key: NoteType; label: string; dot: string }[] = [
  { key: 'design-decision', label: 'Decision', dot: 'bg-blue-600' },
  { key: 'deviation', label: 'Deviation', dot: 'bg-red-600' },
  { key: 'tradeoff', label: 'Tradeoff', dot: 'bg-violet-600' },
  { key: 'open-question', label: 'Question', dot: 'bg-amber-600' },
  { key: 'resolution', label: 'Resolution', dot: 'bg-green-600' },
]
const DOT = Object.fromEntries(TYPES.map(t => [t.key, t.dot])) as Record<NoteType, string>

// Status order matches the issue tracker's own progression.
const STATUSES = ['open', 'in-progress', 'shipped', 'fixed', 'backlog', 'wontfix'] as const
const STATUS_LABEL: Record<string, string> = {
  open: 'Open', 'in-progress': 'In progress', shipped: 'Shipped',
  fixed: 'Fixed', backlog: 'Backlog', wontfix: 'Won’t fix',
}

function ago(iso: string) {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso
  const m = Math.floor((Date.now() - t) / 60000)
  if (m < 60) return `${m}m`
  if (m < 1440) return `${Math.floor(m / 60)}h`
  const d = Math.floor(m / 1440)
  return d < 30 ? `${d}d` : `${Math.floor(d / 30)}mo`
}

type Data = { notes: Note[]; total: number; unanswered: Note[]; projects: Project[] }

export default function Board() {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [limit, setLimit] = useState(80)
  const [active, setActive] = useState<Set<NoteType>>(new Set())
  const [openIssue, setOpenIssue] = useState<string | null>(null)
  const [dragging, setDragging] = useState<{ project: string; id: string } | null>(null)

  const load = useCallback(async (n = limit) => {
    setBusy(true)
    try { setData(await getBoard(0, n)); setError('') }
    catch { setError('Could not read docs/implementation — is the workspace path right?') }
    finally { setBusy(false) }
  }, [limit])

  useEffect(() => { load(limit) }, [limit, load])

  const notes = useMemo(() => {
    if (!data) return []
    return active.size ? data.notes.filter(n => active.has(n.type)) : data.notes
  }, [data, active])

  function toggle(t: NoteType) {
    setActive(prev => {
      const next = new Set(prev)
      next.has(t) ? next.delete(t) : next.add(t)
      return next
    })
  }

  // Optimistic: the card moves now and snaps back if the script refuses, so a
  // failed write is visible instead of silently diverging from the file.
  async function drop(project: string, status: string) {
    if (!dragging || dragging.project !== project) return
    const { id } = dragging
    setDragging(null)
    const before = data
    setData(d => d && ({
      ...d,
      projects: d.projects.map(p => p.project !== project ? p : {
        ...p, issues: p.issues.map(i => i.id === id ? { ...i, status } : i),
      }),
    }))
    const res = await moveIssue(project, id, status)
    if (!res.ok) { setData(before); setError(res.error) } else { load() }
  }

  async function rank(project: string, id: string, severity: string) {
    const res = await rankIssue(project, id, severity)
    if (!res.ok) setError(res.error); else load()
  }

  if (error && !data) return <Center icon={<IconAlertCircle size={20} />} text={error} />
  if (!data) return <Skeleton />

  const totalIssues = data.projects.reduce((n, p) => n + p.issues.length, 0)

  return (
    <div className="h-full w-full bg-background text-foreground flex flex-col">
      <header className="flex items-center gap-4 px-6 py-4 border-b border-border">
        <h1 className="text-base font-medium">Implementation board</h1>
        <p className="text-xs text-muted-foreground tabular-nums">
          {data.total} notes · {totalIssues} issues · {data.unanswered.length} unanswered
        </p>
        <button
          onClick={() => load()}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs
                     ring-1 ring-border hover:bg-accent hover:text-accent-foreground
                     focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Refresh board">
          <IconRefresh size={14} className={cx(busy && 'animate-spin')} /> Refresh
        </button>
      </header>

      {error && (
        <p className="px-6 py-2 text-xs text-destructive border-b border-border">{error}</p>
      )}

      <div className="flex-1 min-h-0 flex">
        <section className="w-[380px] shrink-0 border-r border-border flex flex-col">
          <div className="flex flex-wrap gap-1.5 px-4 py-3 border-b border-border">
            {TYPES.map(t => (
              <button
                key={t.key}
                onClick={() => toggle(t.key)}
                aria-pressed={active.has(t.key)}
                className={cx(
                  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ring-1',
                  'focus-visible:ring-2 focus-visible:ring-ring',
                  active.has(t.key)
                    ? 'bg-accent text-accent-foreground ring-border'
                    : 'ring-border text-muted-foreground hover:bg-accent hover:text-accent-foreground')}>
                <span className={cx('size-1.5 rounded-full', t.dot)} /> {t.label}
              </button>
            ))}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto">
            {data.unanswered.length > 0 && !active.size && (
              <div className="px-4 pt-4">
                <h2 className="text-xs text-muted-foreground mb-2">
                  Unanswered questions · {data.unanswered.length}
                </h2>
                <div className="flex flex-col gap-2 mb-4">
                  {data.unanswered.slice(0, 8).map(q => (
                    <div key={q.ts} className="rounded-lg ring-1 ring-border p-3">
                      <p className="text-sm">{q.title || '(untitled)'}</p>
                      <div className="flex items-center gap-3 mt-2">
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {ago(q.ts)} ago
                        </span>
                        <button
                          onClick={() => sendChatMessage(
                            `把这条 open-question 关掉：「${q.title}」`,
                            { action: 'resolve-open-question', ts: q.ts, title: q.title,
                              how: 'Answer it, then append a resolution with notes.py --resolves ' + q.ts })}
                          className="inline-flex items-center gap-1 text-xs text-muted-foreground
                                     hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring rounded">
                          <IconMessage2 size={13} /> Ask agent to close
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-col">
              {notes.map(n => (
                <article key={n.ts} className="px-4 py-3 border-b border-border">
                  <div className="flex items-center gap-2">
                    <span className={cx('size-1.5 rounded-full shrink-0', DOT[n.type])} />
                    <span className="text-xs text-muted-foreground tabular-nums">{ago(n.ts)}</span>
                    <span className="text-xs text-muted-foreground truncate">{n.author}</span>
                  </div>
                  {n.title && <p className="text-sm mt-1">{n.title}</p>}
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-3 whitespace-pre-wrap">
                    {n.body}{n.truncated && '…'}
                  </p>
                </article>
              ))}
              {notes.length === 0 && (
                <p className="px-4 py-8 text-xs text-muted-foreground">
                  No entries match these filters.
                </p>
              )}
              {!active.size && data.notes.length < data.total && (
                <button
                  onClick={() => setLimit(l => l + 80)}
                  className="m-4 rounded-lg px-3 py-2 text-xs ring-1 ring-border
                             hover:bg-accent hover:text-accent-foreground
                             focus-visible:ring-2 focus-visible:ring-ring">
                  Load older ({data.total - data.notes.length} left)
                </button>
              )}
            </div>
          </div>
        </section>

        <section className="flex-1 min-w-0 overflow-auto">
          {data.projects.length === 0 ? (
            <Center icon={<IconInbox size={20} />}
                    text="No issue tracker yet. Create one with issues.py and it shows up here." />
          ) : data.projects.map(p => (
            <div key={p.project} className="px-6 py-5 border-b border-border">
              <h2 className="text-sm mb-3">
                {p.project}
                <span className="ml-2 text-xs text-muted-foreground tabular-nums">
                  {p.issues.length}
                </span>
              </h2>
              <div className="flex gap-3 overflow-x-auto pb-1">
                {STATUSES.map(s => {
                  const items = p.issues.filter(i => i.status === s)
                  return (
                    <div
                      key={s}
                      onDragOver={e => e.preventDefault()}
                      onDrop={() => drop(p.project, s)}
                      className="w-56 shrink-0 flex flex-col gap-2">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {STATUS_LABEL[s]}
                        <span className="tabular-nums">{items.length}</span>
                      </div>
                      {items.map(i => (
                        <IssueCard
                          key={i.id} issue={i} project={p.project}
                          open={openIssue === i.id}
                          onToggle={() => setOpenIssue(openIssue === i.id ? null : i.id)}
                          onDragStart={() => setDragging({ project: p.project, id: i.id })}
                          onRank={sev => rank(p.project, i.id, sev)} />
                      ))}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}

function IssueCard({ issue, project, open, onToggle, onDragStart, onRank }: {
  issue: Issue; project: string; open: boolean
  onToggle: () => void; onDragStart: () => void; onRank: (s: string) => void
}) {
  return (
    <div draggable onDragStart={onDragStart}
         className="rounded-lg ring-1 ring-border p-2.5 bg-card text-card-foreground">
      <button onClick={onToggle}
              className="w-full text-left focus-visible:ring-2 focus-visible:ring-ring rounded">
        <div className="flex items-center gap-1.5">
          <IconChevronRight size={13}
                            className={cx('shrink-0 transition-transform', open && 'rotate-90')} />
          <span className="text-xs font-mono text-muted-foreground">{issue.id}</span>
          <span className="ml-auto text-xs tabular-nums">{issue.severity}</span>
        </div>
        <p className="text-xs mt-1.5 line-clamp-3">{issue.title}</p>
      </button>

      {open && (
        <div className="mt-2.5 flex flex-col gap-2.5">
          {issue.evidence && (
            <p className="text-xs text-muted-foreground whitespace-pre-wrap">{issue.evidence}</p>
          )}
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Severity
            <select
              value={issue.severity}
              onChange={e => onRank(e.target.value)}
              className="rounded-lg bg-background ring-1 ring-border px-1.5 py-1 text-xs
                         focus-visible:ring-2 focus-visible:ring-ring">
              {['P0', 'P1', 'P2', 'P3'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          {issue.history.length > 0 && (
            <ul className="flex flex-col gap-1">
              {[...issue.history].reverse().slice(0, 6).map((h, k) => (
                <li key={k} className="text-xs text-muted-foreground">
                  <span className="tabular-nums">{ago(h.ts)}</span> · {h.author} — {h.change}
                </li>
              ))}
            </ul>
          )}
          <button
            onClick={() => sendChatMessage(
              `${issue.id}（${issue.title}）现在怎么样？`,
              { action: 'inspect-issue', project, id: issue.id,
                status: issue.status, severity: issue.severity })}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground
                       hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring rounded">
            <IconMessage2 size={13} /> Ask agent
          </button>
        </div>
      )}
    </div>
  )
}

function Center({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="h-full w-full flex flex-col items-center justify-center gap-2 p-8 text-center">
      <span className="text-muted-foreground">{icon}</span>
      <p className="text-sm text-muted-foreground max-w-xs">{text}</p>
    </div>
  )
}

function Skeleton() {
  return (
    <div className="h-full w-full bg-background flex flex-col">
      <div className="h-[57px] border-b border-border" />
      <div className="flex-1 flex">
        <div className="w-[380px] shrink-0 border-r border-border p-4 flex flex-col gap-3">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-16 rounded-lg bg-muted" />
          ))}
        </div>
        <div className="flex-1 p-6 flex gap-3">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="w-56 h-40 rounded-lg bg-muted" />
          ))}
        </div>
      </div>
    </div>
  )
}
