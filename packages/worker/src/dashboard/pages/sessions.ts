export const sessionsPageJs = `async function renderSessionsPage(context) {
  const filter = context.route.query.status || 'all'
  const page = document.createElement('section')
  page.innerHTML = [
    '<div class="page-header">',
    '  <div><h1>Sessions</h1><p>Live and historical agent runs across projects.</p></div>',
    '  <div class="meta" id="sessions-meta"></div>',
    '</div>',
    '<div class="toolbar" id="session-filters"></div>',
    '<div class="table-wrap"><table>',
    '  <thead><tr><th>Session</th><th>Project</th><th>Status</th><th>Started</th><th>Tokens</th><th>Tool Calls</th></tr></thead>',
    '  <tbody id="sessions-body"></tbody>',
    '</table></div>',
  ].join('')

  const filters = [
    { key: 'all', label: 'All' },
    { key: 'active', label: 'Active' },
    { key: 'ended', label: 'Ended' },
  ]
  const filterWrap = page.querySelector('#session-filters')
  filters.forEach(function (item) {
    const button = document.createElement('button')
    button.textContent = item.label
    if (item.key === filter) button.classList.add('active')
    button.addEventListener('click', function () {
      location.hash = item.key === 'all' ? '#/' : '#/?status=' + encodeURIComponent(item.key)
    })
    filterWrap.appendChild(button)
  })

  const data = await api('/sessions' + (filter === 'all' ? '' : '?status=' + encodeURIComponent(filter)))
  const body = page.querySelector('#sessions-body')
  const sessions = Array.isArray(data.sessions) ? data.sessions : []
  page.querySelector('#sessions-meta').textContent = sessions.length + ' session' + (sessions.length === 1 ? '' : 's')

  if (!sessions.length) {
    const row = document.createElement('tr')
    row.innerHTML = '<td colspan="6" class="muted">No sessions found for this filter.</td>'
    body.appendChild(row)
  }

  sessions.forEach(function (session) {
    const row = document.createElement('tr')
    row.innerHTML = [
      '<td><strong>' + escapeHtml(String(session.session_id || '').slice(0, 8)) + '</strong></td>',
      '<td title="' + escapeHtml(session.cwd || session.project_slug) + '">' + escapeHtml(projectName(session.cwd, session.project_slug)) + '</td>',
      '<td>' + statusBadge(session.status) + '</td>',
      '<td>' + escapeHtml(relativeTime(session.started_at)) + '</td>',
      '<td>' + escapeHtml(formatNumber((session.total_input_tokens || 0) + (session.total_output_tokens || 0))) + '</td>',
      '<td>' + escapeHtml(formatNumber(session.tool_calls || 0)) + '</td>',
    ].join('')
    row.addEventListener('click', function () {
      location.hash = '#/session/' + encodeURIComponent(session.session_id)
    })
    body.appendChild(row)
  })

  if (filter === 'active') {
    context.setCleanup(setTimedRefresh(30000))
  }

  return page
}
`
