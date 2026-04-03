export const sessionDetailPageJs = `async function renderSessionDetailPage(context) {
  const sessionId = context.route.params[0]
  const [detail, stats] = await Promise.all([
    api('/sessions/' + encodeURIComponent(sessionId)),
    api('/sessions/' + encodeURIComponent(sessionId) + '/stats'),
  ])

  if (!detail.session) {
    return renderEmptyState('Session not found', 'The requested session is unavailable or you do not have access.')
  }

  const session = detail.session
  const events = Array.isArray(detail.events || detail.recent_events) ? (detail.events || detail.recent_events) : []
  const totalTokens = (stats.total_input_tokens || 0) + (stats.total_output_tokens || 0)
  const inputRatio = totalTokens > 0 ? Math.round(((stats.total_input_tokens || 0) / totalTokens) * 100) : 0
  const page = document.createElement('section')
  page.innerHTML = [
    '<div class="page-header">',
    '  <div><h1>Session ' + escapeHtml(String(session.session_id).slice(0, 8)) + '</h1><p>' + escapeHtml(projectName(session.cwd, session.project_slug)) + ' <span class=\"muted\" style=\"font-size:12px\">' + escapeHtml(session.cwd || '') + '</span></p></div>',
    '  <button id="back-button">Back</button>',
    '</div>',
    '<div class="card-grid">',
    cardHtml('Session ID', session.session_id),
    cardHtml('Project', projectName(session.cwd, session.project_slug)),
    cardHtml('Status', statusBadge(session.status)),
    cardHtml('Duration', sessionDuration(session.started_at, session.last_seen_at)),
    '</div>',
    '<div class="card" style="margin-bottom:1rem;">',
    '  <div class="card-label">Token Usage</div>',
    '  <div class="card-value">' + escapeHtml(formatNumber(totalTokens)) + ' total</div>',
    '  <div class="progress"><div class="progress-fill" style="width:' + inputRatio + '%"></div></div>',
    '  <div class="split"><span>Input ' + escapeHtml(formatNumber(stats.total_input_tokens || 0)) + '</span><span>Output ' + escapeHtml(formatNumber(stats.total_output_tokens || 0)) + '</span></div>',
    '</div>',
    '<div class="table-wrap"><table>',
    '  <thead><tr><th>Time</th><th>Type</th><th>Role</th><th>Preview</th><th>Tool</th><th>Model</th><th>Tokens</th></tr></thead>',
    '  <tbody id="events-body"></tbody>',
    '</table></div>',
  ].join('')

  page.querySelector('#back-button').addEventListener('click', function () {
    history.back()
  })

  const body = page.querySelector('#events-body')
  if (!events.length) {
    const row = document.createElement('tr')
    row.innerHTML = '<td colspan="7" class="muted">No recent events available.</td>'
    body.appendChild(row)
  }

  events.forEach(function (event) {
    const tokenCount = (event.input_tokens || 0) + (event.output_tokens || 0)
    const row = document.createElement('tr')
    row.innerHTML = [
      '<td>' + escapeHtml(formatTimestamp(event.timestamp)) + '</td>',
      '<td>' + escapeHtml(event.type || '-') + '</td>',
      '<td>' + escapeHtml(event.role || '-') + '</td>',
      '<td title="' + escapeHtml(event.content_preview || '') + '">' + escapeHtml(truncate(event.content_preview || '-', 80)) + '</td>',
      '<td>' + escapeHtml(event.tool_name || '-') + '</td>',
      '<td>' + escapeHtml(event.model || '-') + '</td>',
      '<td>' + escapeHtml(formatNumber(tokenCount)) + '</td>',
    ].join('')
    body.appendChild(row)
  })

  return page
}

function cardHtml(label, value) {
  return '<div class="card"><div class="card-label">' + label + '</div><div class="card-value">' + value + '</div></div>'
}
`
