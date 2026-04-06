export const sessionsPageJs = `async function renderSessionsPage(context) {
  const filter = context.route.query.status || 'all'
  const projectFilter = context.route.query.project || ''
  const params = new URLSearchParams()
  if (filter !== 'all') params.set('status', filter)
  if (projectFilter) params.set('project_slug', projectFilter)
  const page = document.createElement('section')
  page.innerHTML = [
    '<div class="page-header">',
    '  <div><h1>Sessions</h1><p>Live and historical agent runs across projects.</p></div>',
    '  <div class="meta" id="sessions-meta"></div>',
    '</div>',
    '<div class="toolbar" id="session-filters"></div>',
    '<div class="table-wrap sessions-table-desktop"><table>',
    '  <thead><tr><th>Session</th><th>Project</th><th>Status</th><th>Started</th><th>Tokens</th><th>Tool Calls</th><th>Summary</th></tr></thead>',
    '  <tbody id="sessions-body"></tbody>',
    '</table></div>',
    '<div class="sessions-card-list" id="sessions-cards"></div>',
  ].join('')

  const filters = [
    { key: 'all', label: 'All' },
    { key: 'active', label: 'Active' },
    { key: 'ended', label: 'Ended' },
  ]
  const filterWrap = page.querySelector('#session-filters')
  if (projectFilter) {
    var clearBtn = document.createElement('button')
    clearBtn.textContent = projectFilter + ' \\u00d7'
    clearBtn.style.background = 'var(--yellow)'
    clearBtn.style.color = '#fff'
    clearBtn.style.borderColor = 'var(--yellow)'
    clearBtn.addEventListener('click', function () {
      var next = new URLSearchParams()
      if (filter !== 'all') next.set('status', filter)
      location.hash = '#/' + (next.toString() ? '?' + next.toString() : '')
    })
    filterWrap.appendChild(clearBtn)
  }
  filters.forEach(function (item) {
    const button = document.createElement('button')
    button.textContent = item.label
    if (item.key === filter) button.classList.add('active')
    button.addEventListener('click', function () {
      const next = new URLSearchParams()
      if (item.key !== 'all') next.set('status', item.key)
      if (projectFilter) next.set('project', projectFilter)
      location.hash = '#/' + (next.toString() ? '?' + next.toString() : '')
    })
    filterWrap.appendChild(button)
  })

  const data = await api('/sessions' + (params.toString() ? '?' + params.toString() : ''))
  const body = page.querySelector('#sessions-body')
  const cardsWrap = page.querySelector('#sessions-cards')
  const sessions = Array.isArray(data.sessions) ? data.sessions : []
  page.querySelector('#sessions-meta').textContent = sessions.length + ' session' + (sessions.length === 1 ? '' : 's') + (projectFilter ? ' in ' + projectFilter : '')

  if (!sessions.length) {
    const row = document.createElement('tr')
    row.innerHTML = '<td colspan="7" class="muted">No sessions found for this filter.</td>'
    body.appendChild(row)
    cardsWrap.innerHTML = '<div class="card muted">No sessions found for this filter.</div>'
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
      '<td class="muted" title="' + escapeHtml(session.summary || 'No summary') + '">' + escapeHtml(truncate(session.summary || 'No summary', 80)) + '</td>',
    ].join('')
    row.addEventListener('click', function () {
      location.hash = '#/session/' + encodeURIComponent(session.session_id)
    })
    body.appendChild(row)

    var card = document.createElement('div')
    card.className = 'card session-card'
    card.innerHTML = [
      '<div class="session-card__header">',
      '  <strong>' + escapeHtml(String(session.session_id || '').slice(0, 8)) + '</strong>',
      '  ' + statusBadge(session.status),
      '</div>',
      '<div class="session-card__project" title="' + escapeHtml(session.cwd || session.project_slug) + '">' + escapeHtml(projectName(session.cwd, session.project_slug)) + '</div>',
      '<div class="session-card__stats">',
      '  <span>' + escapeHtml(relativeTime(session.started_at)) + '</span>',
      '  <span>' + escapeHtml(formatNumber((session.total_input_tokens || 0) + (session.total_output_tokens || 0))) + ' tokens</span>',
      '  <span>' + escapeHtml(formatNumber(session.tool_calls || 0)) + ' tools</span>',
      '</div>',
      '<div class="session-card__summary muted">' + escapeHtml(truncate(session.summary || 'No summary', 120)) + '</div>',
    ].join('')
    card.addEventListener('click', function () {
      location.hash = '#/session/' + encodeURIComponent(session.session_id)
    })
    cardsWrap.appendChild(card)
  })

  if (filter === 'active') {
    context.setCleanup(setTimedRefresh(30000))
  }

  return page
}
`
