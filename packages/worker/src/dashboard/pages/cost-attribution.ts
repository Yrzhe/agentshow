export function createCostAttributionPage(): string {
  return String.raw`
function formatCostAttributionCost(value) {
  return '$' + Number(value || 0).toFixed(2)
}

function renderCostAttributionChart(items, emptyLabel, labelRenderer) {
  if (!items.length) return '<p class="muted" style="margin:0">' + emptyLabel + '</p>'
  var maxCost = items.reduce(function (max, item) {
    return Math.max(max, Number(item.estimated_cost || 0))
  }, 0) || 1
  return '<div class="chart-list">' + items.map(function (item) {
    var width = Math.max(8, Math.round((Number(item.estimated_cost || 0) / maxCost) * 100))
    return '<div class="chart-row">' +
      '<div class="chart-row__label"><span>' + labelRenderer(item) + '</span><strong>' + formatCostAttributionCost(item.estimated_cost) + '</strong></div>' +
      '<div class="chart-bar"><div class="chart-bar__fill" style="width:' + width + '%"></div></div>' +
    '</div>'
  }).join('') + '</div>'
}

function renderCostAttributionSessionRows(projectSlug, sessions) {
  if (!sessions) {
    return '<tr><td colspan="4"><div class="muted">Loading sessions…</div></td></tr>'
  }
  if (!sessions.length) {
    return '<tr><td colspan="4"><div class="muted">No sessions found for this project.</div></td></tr>'
  }
  return sessions.map(function (session) {
    var title = session.task || session.summary || session.session_id
    var description = session.summary && session.summary !== title ? '<div class="muted" style="margin-top:4px">' + escapeHtml(truncate(session.summary, 160)) + '</div>' : ''
    return '<tr>' +
      '<td><a href="#/session/' + encodeURIComponent(session.session_id) + '">' + escapeHtml(truncate(title, 80)) + '</a>' + description + '</td>' +
      '<td>' + escapeHtml(formatTimestamp(session.started_at)) + '</td>' +
      '<td>' + statusBadge(session.status) + '</td>' +
      '<td>' + formatNumber(Number(session.input_tokens || 0) + Number(session.output_tokens || 0)) + ' · ' + formatCostAttributionCost(session.estimated_cost) + '</td>' +
    '</tr>'
  }).join('')
}

function renderCostAttributionProjectTable(projects, expandedProject, sessionMap) {
  if (!projects.length) {
    return '<div class="panel"><p class="muted" style="margin:0">No project cost data yet.</p></div>'
  }
  return '<div class="table-wrap"><table>' +
    '<thead><tr><th>Project</th><th>Sessions</th><th>Tokens</th><th>Est. cost</th></tr></thead>' +
    '<tbody>' + projects.map(function (project) {
      var slug = String(project.project_slug || '')
      var isOpen = expandedProject === slug
      var toggleLabel = isOpen ? 'Hide sessions' : 'Show sessions'
      var row = '<tr data-project-row="' + escapeHtml(slug) + '">' +
        '<td><button type="button" data-project-toggle="' + escapeHtml(slug) + '" style="padding:0;border:0;background:none;color:var(--text);border-radius:0;text-align:left;font-weight:600">' + escapeHtml(projectName(null, slug || 'unknown')) + '</button><div class="muted" style="margin-top:4px">' + escapeHtml(slug || 'unknown') + '</div></td>' +
        '<td>' + formatNumber(project.session_count) + '<div class="muted" style="margin-top:4px">' + toggleLabel + '</div></td>' +
        '<td>' + formatNumber(Number(project.input_tokens || 0) + Number(project.output_tokens || 0)) + '</td>' +
        '<td>' + formatCostAttributionCost(project.estimated_cost) + '</td>' +
      '</tr>'
      if (!isOpen) return row
      return row + '<tr><td colspan="4" style="padding:0">' +
        '<div style="padding:0 1rem 1rem 1rem;background:var(--panel-alt)">' +
          '<table style="min-width:0"><thead><tr><th>Session</th><th>Started</th><th>Status</th><th>Tokens / cost</th></tr></thead><tbody>' +
            renderCostAttributionSessionRows(slug, sessionMap[slug]) +
          '</tbody></table>' +
        '</div>' +
      '</td></tr>'
    }).join('') + '</tbody></table></div>'
}

function renderCostAttributionToolTable(tools) {
  if (!tools.length) {
    return '<div class="panel"><p class="muted" style="margin:0">No tool cost data yet.</p></div>'
  }
  return '<div class="table-wrap"><table>' +
    '<thead><tr><th>Tool</th><th>Calls</th><th>Tokens</th><th>Est. cost</th></tr></thead>' +
    '<tbody>' + tools.map(function (tool) {
      return '<tr>' +
        '<td>' + escapeHtml(tool.tool_name || 'unknown') + '</td>' +
        '<td>' + formatNumber(tool.call_count) + '</td>' +
        '<td>' + formatNumber(Number(tool.input_tokens || 0) + Number(tool.output_tokens || 0)) + '</td>' +
        '<td>' + formatCostAttributionCost(tool.estimated_cost) + '</td>' +
      '</tr>'
    }).join('') + '</tbody></table></div>'
}

export async function renderCostAttributionPage(root) {
  var hash = location.hash || '#/cost'
  var queryIndex = hash.indexOf('?')
  var query = new URLSearchParams(queryIndex >= 0 ? hash.slice(queryIndex + 1) : '')
  var initialDays = Number(query.get('days') || 30)
  var state = {
    days: [7, 30, 90].indexOf(initialDays) >= 0 ? initialDays : 30,
    projects: [],
    tools: [],
    sessionsByProject: {},
    expandedProject: null,
  }

  function updateHashDays(days) {
    var next = new URLSearchParams(location.hash.split('?')[1] || '')
    next.set('days', String(days))
    location.hash = '#/cost?' + next.toString()
  }

  async function loadSessions(projectSlug) {
    if (state.sessionsByProject[projectSlug]) return
    state.sessionsByProject[projectSlug] = null
    render()
    var response = await fetch('/api/cost/by-session?days=' + state.days + '&project=' + encodeURIComponent(projectSlug), { credentials: 'include' })
    var payload = await response.json()
    state.sessionsByProject[projectSlug] = Array.isArray(payload.sessions) ? payload.sessions : []
    render()
  }

  function bindEvents() {
    Array.from(root.querySelectorAll('[data-days]')).forEach(function (button) {
      button.addEventListener('click', function () {
        var nextDays = Number(button.getAttribute('data-days') || 30)
        if (nextDays === state.days) return
        updateHashDays(nextDays)
      })
    })
    Array.from(root.querySelectorAll('[data-project-toggle]')).forEach(function (button) {
      button.addEventListener('click', async function () {
        var projectSlug = button.getAttribute('data-project-toggle') || ''
        state.expandedProject = state.expandedProject === projectSlug ? null : projectSlug
        render()
        if (state.expandedProject !== null) await loadSessions(projectSlug)
      })
    })
  }

  function render() {
    var totalProjectCost = state.projects.reduce(function (sum, item) { return sum + Number(item.estimated_cost || 0) }, 0)
    var totalToolCost = state.tools.reduce(function (sum, item) { return sum + Number(item.estimated_cost || 0) }, 0)
    root.innerHTML = '<section>' +
      '<div class="page-header"><div><h2>Cost Attribution</h2><p class="muted">See which projects, sessions, and tools account for the most spend.</p></div></div>' +
      '<div class="toolbar">' +
        [7, 30, 90].map(function (days) {
          return '<button type="button" data-days="' + days + '"' + (days === state.days ? ' class="active"' : '') + '>' + days + ' days</button>'
        }).join('') +
      '</div>' +
      '<div class="card-grid">' +
        '<div class="panel"><span class="muted">Projects tracked</span><h3>' + formatNumber(state.projects.length) + '</h3></div>' +
        '<div class="panel"><span class="muted">Tools tracked</span><h3>' + formatNumber(state.tools.length) + '</h3></div>' +
        '<div class="panel"><span class="muted">Project-attributed cost</span><h3>' + formatCostAttributionCost(totalProjectCost) + '</h3></div>' +
        '<div class="panel"><span class="muted">Tool-attributed cost</span><h3>' + formatCostAttributionCost(totalToolCost) + '</h3></div>' +
      '</div>' +
      '<div style="display:grid;gap:24px">' +
        '<div class="panel"><h3 style="margin-top:0">By Project</h3><p class="muted">Ranked by estimated spend over the selected period.</p>' +
          renderCostAttributionChart(state.projects.slice(0, 8), 'No project cost data yet.', function (item) {
            return escapeHtml(projectName(null, item.project_slug || 'unknown'))
          }) +
        '</div>' +
        renderCostAttributionProjectTable(state.projects, state.expandedProject, state.sessionsByProject) +
        '<div class="panel"><h3 style="margin-top:0">By Tool</h3><p class="muted">Identify the tool categories driving the highest spend.</p>' +
          renderCostAttributionChart(state.tools.slice(0, 8), 'No tool cost data yet.', function (item) {
            return escapeHtml(item.tool_name || 'unknown')
          }) +
        '</div>' +
        renderCostAttributionToolTable(state.tools) +
      '</div>' +
    '</section>'
    bindEvents()
  }

  root.innerHTML = '<div class="panel"><div class="muted">Loading cost attribution…</div></div>'

  try {
    var results = await Promise.all([
      fetch('/api/cost/by-project?days=' + state.days, { credentials: 'include' }),
      fetch('/api/cost/by-tool?days=' + state.days, { credentials: 'include' }),
    ])
    var payloads = await Promise.all(results.map(function (response) { return response.json() }))
    state.projects = Array.isArray(payloads[0].projects) ? payloads[0].projects : []
    state.tools = Array.isArray(payloads[1].tools) ? payloads[1].tools : []
    render()
  } catch (error) {
    root.innerHTML = '<section><div class="page-header"><div><h2>Cost Attribution</h2><p class="muted">See which projects, sessions, and tools account for the most spend.</p></div></div><div class="panel"><p class="muted" style="margin:0">Failed to load cost attribution data.</p></div></section>'
  }
}
`
}
