import { useEffect, useState } from 'react'
import { focusTab } from 'moi'
import { getSummary } from './board-summary.server'

export const config = { colSpan: 2, rowSpan: 1 } as const

function ago(iso: string) {
  const t = Date.parse(iso)
  if (!iso || Number.isNaN(t)) return '—'
  const m = Math.floor((Date.now() - t) / 60000)
  if (m < 60) return `${m}m ago`
  if (m < 1440) return `${Math.floor(m / 60)}h ago`
  const d = Math.floor(m / 1440)
  return d < 30 ? `${d}d ago` : `${Math.floor(d / 30)}mo ago`
}

type S = Awaited<ReturnType<typeof getSummary>>

export default function BoardSummary() {
  const [s, setS] = useState<S | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => { getSummary().then(setS).catch(() => setFailed(true)) }, [])

  return (
    <button
      onClick={() => focusTab('view:board')}
      className="h-full w-full bg-background text-foreground p-4 flex flex-col text-left
                 focus-visible:ring-2 focus-visible:ring-ring"
      aria-label="Open the implementation board">
      <p className="text-xs text-muted-foreground">Implementation</p>

      {failed ? (
        <p className="mt-auto text-xs text-muted-foreground">Log unreadable — open the board.</p>
      ) : (
        <>
          <div className="mt-2 flex items-baseline gap-5 tabular-nums">
            <Stat n={s?.urgent} label="P0/P1 active" />
            <Stat n={s?.awaitingCheck} label="awaiting check" />
            <Stat n={s?.unanswered} label="unanswered" />
          </div>
          <p className="mt-auto text-xs text-muted-foreground tabular-nums">
            {s ? `${s.notes} notes · last ${ago(s.lastTs)}` : ' '}
          </p>
        </>
      )}
    </button>
  )
}

function Stat({ n, label }: { n?: number; label: string }) {
  return (
    <span className="flex flex-col">
      <span className="text-2xl">{n ?? '—'}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </span>
  )
}
