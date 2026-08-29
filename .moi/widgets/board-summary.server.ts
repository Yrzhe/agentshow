// Dashboard summary of the implementation log. Counts only — the view owns detail.

import { loadNotes, loadIssues } from '../lib/board-data'

const ACTIVE = new Set(['open', 'in-progress'])

export async function getSummary() {
  const [{ total, unanswered, notes }, projects] = await Promise.all([
    loadNotes(0, 1), loadIssues(),
  ])
  const issues = projects.flatMap(p => p.issues)
  return {
    notes: total,
    unanswered: unanswered.length,
    // Active work worth surfacing is the high-severity end; the rest is noise
    // on a card this size.
    urgent: issues.filter(i => ACTIVE.has(i.status) && (i.severity === 'P0' || i.severity === 'P1')).length,
    // `fixed` means independently verified, so `shipped` is a waiting queue.
    awaitingCheck: issues.filter(i => i.status === 'shipped').length,
    lastTs: notes[0]?.ts ?? '',
  }
}
