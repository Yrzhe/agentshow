// RPC surface for the implementation board.
//
// Reads come straight from the files; writes go back through workspace-layout's
// CLI so ids, history rows and the offline HTML viewer stay consistent with what
// an agent would have produced. `board` as the author distinguishes a change made
// by a person dragging a card from one an agent decided on.

import {
  loadNotes, loadIssues, setIssueStatus, setIssueSeverity,
} from '../lib/board-data'

const AUTHOR = 'board'

export async function getBoard(offset = 0, limit = 80) {
  const [notes, projects] = await Promise.all([loadNotes(offset, limit), loadIssues()])
  return { ...notes, projects }
}

export async function moveIssue(project: string, id: string, status: string) {
  return setIssueStatus(project, id, status, AUTHOR)
}

export async function rankIssue(project: string, id: string, severity: string) {
  return setIssueSeverity(project, id, severity, AUTHOR)
}
