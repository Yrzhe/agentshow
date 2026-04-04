export function createTeamsPage(): string {
  return String.raw`
function formatTeamCost(value) {
  return '$' + Number(value || 0).toFixed(2)
}

function currentWeekStart() {
  var now = new Date()
  var day = (now.getUTCDay() + 6) % 7
  now.setUTCDate(now.getUTCDate() - day)
  return now.toISOString().slice(0, 10)
}

function isoWeekValue(dateString) {
  var date = new Date(dateString + 'T00:00:00Z')
  var day = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - day)
  var yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  var week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7)
  return date.getUTCFullYear() + '-W' + String(week).padStart(2, '0')
}

function weekValueToStart(value) {
  if (!value || !/^\d{4}-W\d{2}$/.test(value)) return currentWeekStart()
  var parts = value.split('-W')
  var year = Number(parts[0])
  var week = Number(parts[1])
  var jan4 = new Date(Date.UTC(year, 0, 4))
  var day = jan4.getUTCDay() || 7
  jan4.setUTCDate(jan4.getUTCDate() - day + 1 + (week - 1) * 7)
  return jan4.toISOString().slice(0, 10)
}

async function teamRequest(path, options) {
  var response = await fetch('/api/teams' + path, Object.assign({ credentials: 'include' }, options || {}))
  var payload = await response.json()
  if (!response.ok) throw new Error(payload.error || 'Request failed')
  return payload
}

function renderTeamCards(teams) {
  if (!teams.length) return '<div class="panel"><p class="muted" style="margin:0">You are not in any teams yet.</p></div>'
  return '<div class="card-grid">' + teams.map(function (team) {
    return '<a class="panel project-card" href="#/team/' + encodeURIComponent(team.id) + '">' +
      '<div class="project-card__top"><span class="project-card__slug">' + escapeHtml(team.name) + '</span><span class="status-chip status-chip--active">' + escapeHtml(team.role) + '</span></div>' +
      '<p class="muted project-card__cwd">' + escapeHtml(team.id) + '</p>' +
      '<div class="muted">Created ' + escapeHtml(formatTimestamp(team.created_at)) + '</div>' +
    '</a>'
  }).join('') + '</div>'
}

function renderTeamReport(report) {
  if (!report) return ''
  var max = report.members.reduce(function (n, member) { return Math.max(n, Number(member.estimated_cost || 0)) }, 0) || 1
  return '<div class="panel"><div class="page-header"><div><h3 style="margin:0">Weekly Report</h3><p class="muted">Member contribution for week starting ' + escapeHtml(report.week_start) + '.</p></div></div>' +
    '<div class="chart-list" style="margin-bottom:16px">' + report.members.map(function (member) {
      var total = Number(member.input_tokens || 0) + Number(member.output_tokens || 0)
      var width = Math.max(8, Math.round(Number(member.estimated_cost || 0) / max * 100))
      return '<div class="chart-row"><div class="chart-row__label"><span>' + escapeHtml(member.github_login || member.email || member.user_id) + '</span><strong>' + formatNumber(total) + ' · ' + formatTeamCost(member.estimated_cost) + '</strong></div><div class="chart-bar"><div class="chart-bar__fill" style="width:' + width + '%"></div></div></div>'
    }).join('') + '</div>' +
    '<div class="table-wrap"><table><thead><tr><th>Member</th><th>Sessions</th><th>Tokens</th><th>Tool calls</th><th>Cost</th><th>Share</th></tr></thead><tbody>' +
      report.members.map(function (member) {
        var total = Number(member.input_tokens || 0) + Number(member.output_tokens || 0)
        var share = Number(report.totals.estimated_cost || 0) > 0 ? (Number(member.estimated_cost || 0) / Number(report.totals.estimated_cost || 0)) * 100 : 0
        return '<tr><td>' + escapeHtml(member.github_login || member.email || member.user_id) + '</td><td>' + formatNumber(member.session_count) + '</td><td>' + formatNumber(total) + '</td><td>' + formatNumber(member.tool_calls) + '</td><td>' + formatTeamCost(member.estimated_cost) + '</td><td>' + share.toFixed(1) + '%</td></tr>'
      }).join('') +
    '</tbody></table></div></div>'
}

function renderTeamDetail(state) {
  var team = state.team
  var usage = state.usage || { session_count: 0, input_tokens: 0, output_tokens: 0, tool_calls: 0, estimated_cost: 0, member_count: 0, active_members: 0 }
  var sessions = state.recent_sessions || []
  var invites = state.invites || []
  var members = state.members || []
  return '<section><div class="page-header"><div><h2>' + escapeHtml(team.name) + '</h2><p class="muted">Team ' + escapeHtml(team.id) + ' · ' + escapeHtml(state.viewer_role) + '</p></div><a href="#/teams">Back to teams</a></div>' +
    '<div class="card-grid">' +
      '<div class="panel"><span class="muted">Members</span><h3>' + formatNumber(usage.member_count) + '</h3></div>' +
      '<div class="panel"><span class="muted">Active members</span><h3>' + formatNumber(usage.active_members) + '</h3></div>' +
      '<div class="panel"><span class="muted">30d sessions</span><h3>' + formatNumber(usage.session_count) + '</h3></div>' +
      '<div class="panel"><span class="muted">30d est. cost</span><h3>' + formatTeamCost(usage.estimated_cost) + '</h3></div>' +
    '</div>' +
    (state.isOwner ? '<form id="team-rename-form" class="panel" style="display:flex;gap:8px;align-items:center;margin-bottom:16px"><input id="team-name-input" value="' + escapeHtml(team.name) + '" style="flex:1;min-width:180px;padding:0.8rem 1rem;border-radius:12px;border:1px solid var(--border);background:var(--panel-alt);color:var(--text)"><button type="submit">Rename team</button><button type="button" id="team-delete-button">Delete team</button></form>' : '') +
    '<div class="split-layout">' +
      '<div class="panel"><h3 style="margin-top:0">Members</h3><div class="table-wrap"><table><thead><tr><th>Member</th><th>Role</th><th>Joined</th><th>Actions</th></tr></thead><tbody>' + members.map(function (member) {
        var canEdit = state.can_manage && member.user_id !== team.owner_id
        return '<tr><td>' + escapeHtml(member.github_login || member.email || member.user_id) + '<div class="muted" style="margin-top:4px">' + escapeHtml(member.email || member.user_id) + '</div></td><td>' + escapeHtml(member.role) + '</td><td>' + escapeHtml(formatTimestamp(member.joined_at)) + '</td><td>' + (canEdit ? '<button type="button" data-role-user="' + escapeHtml(member.user_id) + '" data-role-next="' + (member.role === 'admin' ? 'member' : 'admin') + '">' + (member.role === 'admin' ? 'Make member' : 'Make admin') + '</button> <button type="button" data-remove-user="' + escapeHtml(member.user_id) + '">Remove</button>' : '<span class="muted">No actions</span>') + '</td></tr>'
      }).join('') + '</tbody></table></div></div>' +
      '<div style="display:grid;gap:16px">' +
        (state.can_manage ? '<form id="team-invite-form" class="panel" style="display:grid;gap:12px"><h3 style="margin:0">Invite Member</h3><input id="team-invite-email" type="email" placeholder="name@example.com" style="padding:0.8rem 1rem;border-radius:12px;border:1px solid var(--border);background:var(--panel-alt);color:var(--text)"><button type="submit">Create invite</button></form>' : '') +
        (state.can_manage ? '<div class="panel"><h3 style="margin-top:0">Pending Invites</h3>' + (invites.length ? '<div class="table-wrap"><table><thead><tr><th>Email</th><th>Link</th><th>Expires</th></tr></thead><tbody>' + invites.map(function (invite) { return '<tr><td>' + escapeHtml(invite.email) + '</td><td><code>/api/teams/invites/' + escapeHtml(invite.id) + '/accept</code></td><td>' + escapeHtml(formatTimestamp(invite.expires_at)) + '</td></tr>' }).join('') + '</tbody></table></div>' : '<p class="muted" style="margin:0">No pending invites.</p>') + '</div>' : '') +
      '</div>' +
    '</div>' +
    '<div class="panel" style="margin-top:16px"><h3 style="margin-top:0">Recent Activity</h3>' + (sessions.length ? '<div class="table-wrap"><table><thead><tr><th>Session</th><th>Member</th><th>Project</th><th>Started</th><th>Tokens</th></tr></thead><tbody>' + sessions.map(function (session) {
      var total = Number(session.total_input_tokens || 0) + Number(session.total_output_tokens || 0)
      return '<tr><td><a href="#/session/' + encodeURIComponent(session.session_id) + '">' + escapeHtml(truncate(session.task || session.summary || session.session_id, 72)) + '</a></td><td>' + escapeHtml(session.github_login || session.email || session.user_id) + '</td><td>' + escapeHtml(session.project_slug) + '</td><td>' + escapeHtml(formatTimestamp(session.started_at)) + '</td><td>' + formatNumber(total) + '</td></tr>'
    }).join('') + '</tbody></table></div>' : '<p class="muted" style="margin:0">No recent sessions.</p>') + '</div>' +
    (state.can_manage ? '<form id="team-report-form" class="toolbar" style="margin-top:16px"><label class="muted" for="team-report-week">Week</label><input id="team-report-week" type="week" value="' + escapeHtml(isoWeekValue(state.week_start)) + '" style="padding:0.55rem 0.8rem;border-radius:12px;border:1px solid var(--border);background:var(--panel-alt);color:var(--text)"><button type="submit">Load report</button></form>' + renderTeamReport(state.report) : '') +
  '</section>'
}

export async function renderTeamsPage(root) {
  root.innerHTML = '<div class="panel"><div class="muted">Loading teams…</div></div>'
  try {
    var payload = await teamRequest('', { method: 'GET' })
    root.innerHTML = '<section><div class="page-header"><div><h2>Teams</h2><p class="muted">Create a shared workspace for team activity and reporting.</p></div></div><form id="team-create-form" class="panel" style="display:flex;gap:8px;align-items:center;margin-bottom:16px"><input id="team-create-name" placeholder="New team name" style="flex:1;min-width:180px;padding:0.8rem 1rem;border-radius:12px;border:1px solid var(--border);background:var(--panel-alt);color:var(--text)"><button type="submit">Create team</button></form>' + renderTeamCards(Array.isArray(payload.teams) ? payload.teams : []) + '</section>'
    root.querySelector('#team-create-form').addEventListener('submit', async function (event) {
      event.preventDefault()
      var input = root.querySelector('#team-create-name')
      var created = await teamRequest('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: input.value }) })
      location.hash = '#/team/' + encodeURIComponent(created.team.id)
    })
  } catch (error) {
    root.innerHTML = '<section><div class="page-header"><div><h2>Teams</h2><p class="muted">Create a shared workspace for team activity and reporting.</p></div></div><div class="panel"><p class="muted" style="margin:0">' + escapeHtml(error.message || 'Failed to load teams') + '</p></div></section>'
  }
}

export async function renderTeamDetailPage(root, teamId, query) {
  var weekStart = query && query.week ? String(query.week) : currentWeekStart()
  root.innerHTML = '<div class="panel"><div class="muted">Loading team…</div></div>'
  try {
    var detail = await teamRequest('/' + encodeURIComponent(teamId), { method: 'GET' })
    var state = { team: detail.team, members: Array.isArray(detail.members) ? detail.members : [], invites: Array.isArray(detail.invites) ? detail.invites : [], recent_sessions: Array.isArray(detail.recent_sessions) ? detail.recent_sessions : [], usage: detail.usage, viewer_role: detail.viewer_role, can_manage: Boolean(detail.can_manage), isOwner: detail.team && detail.team.owner_id === currentUser.user_id, week_start: weekStart, report: null }
    if (state.can_manage) state.report = await teamRequest('/' + encodeURIComponent(teamId) + '/report?week=' + encodeURIComponent(weekStart), { method: 'GET' })
    root.innerHTML = renderTeamDetail(state)
    bindTeamDetailEvents(root, teamId, state)
  } catch (error) {
    root.innerHTML = '<section><div class="page-header"><div><h2>Team</h2><p class="muted">Shared workspace activity.</p></div></div><div class="panel"><p class="muted" style="margin:0">' + escapeHtml(error.message || 'Failed to load team') + '</p></div></section>'
  }
}

function bindTeamDetailEvents(root, teamId, state) {
  var renameForm = root.querySelector('#team-rename-form')
  if (renameForm) renameForm.addEventListener('submit', async function (event) {
    event.preventDefault()
    var input = root.querySelector('#team-name-input')
    await teamRequest('/' + encodeURIComponent(teamId), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: input.value }) })
    await renderTeamDetailPage(root, teamId, { week: state.week_start })
  })
  var deleteButton = root.querySelector('#team-delete-button')
  if (deleteButton) deleteButton.addEventListener('click', async function () {
    await teamRequest('/' + encodeURIComponent(teamId), { method: 'DELETE' })
    location.hash = '#/teams'
  })
  var inviteForm = root.querySelector('#team-invite-form')
  if (inviteForm) inviteForm.addEventListener('submit', async function (event) {
    event.preventDefault()
    var input = root.querySelector('#team-invite-email')
    var payload = await teamRequest('/' + encodeURIComponent(teamId) + '/members', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: input.value }) })
    await renderTeamDetailPage(root, teamId, { week: state.week_start })
  })
  Array.from(root.querySelectorAll('[data-role-user]')).forEach(function (button) {
    button.addEventListener('click', async function () {
      await teamRequest('/' + encodeURIComponent(teamId) + '/members/' + encodeURIComponent(button.getAttribute('data-role-user')), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: button.getAttribute('data-role-next') }) })
      await renderTeamDetailPage(root, teamId, { week: state.week_start })
    })
  })
  Array.from(root.querySelectorAll('[data-remove-user]')).forEach(function (button) {
    button.addEventListener('click', async function () {
      await teamRequest('/' + encodeURIComponent(teamId) + '/members/' + encodeURIComponent(button.getAttribute('data-remove-user')), { method: 'DELETE' })
      await renderTeamDetailPage(root, teamId, { week: state.week_start })
    })
  })
  var reportForm = root.querySelector('#team-report-form')
  if (reportForm) reportForm.addEventListener('submit', function (event) {
    event.preventDefault()
    var input = root.querySelector('#team-report-week')
    location.hash = '#/team/' + encodeURIComponent(teamId) + '?week=' + encodeURIComponent(weekValueToStart(input.value))
  })
}
`
}
