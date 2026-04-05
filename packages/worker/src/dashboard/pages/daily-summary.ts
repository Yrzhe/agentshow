export function createDailySummaryPage(): string {
  return String.raw`
export async function renderDailySummaryPage(root) {
  const today = new Date().toISOString().slice(0, 10);
  const selectedDate = location.hash.split('?')[1] ? (new URLSearchParams(location.hash.split('?')[1]).get('date') || today) : today;

  root.innerHTML = '<section>' +
    '<div class="page-header">' +
      '<div><h2>Daily Summary</h2><p class="muted">Project-level recap of agent work for a specific day.</p></div>' +
      '<form id="daily-summary-form" class="toolbar" style="margin:0;">' +
        '<input id="daily-summary-date" type="date" value="' + selectedDate + '" />' +
        '<button type="submit">Load</button>' +
      '</form>' +
    '</div>' +
    '<div id="daily-summary-body" class="panel"><div class="muted">Loading daily summary…</div></div>' +
  '</section>';

  const form = root.querySelector('#daily-summary-form');
  const dateInput = root.querySelector('#daily-summary-date');
  const body = root.querySelector('#daily-summary-body');

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    location.hash = '#/daily-summary?date=' + encodeURIComponent(dateInput.value || today);
  });

  try {
    const response = await fetch('/api/daily-summary?date=' + encodeURIComponent(selectedDate), { credentials: 'include' });
    const payload = await response.json();
    const projects = Array.isArray(payload.projects) ? payload.projects : [];
    const totals = payload.totals || { sessions: 0, input_tokens: 0, output_tokens: 0 };

    if (!projects.length) {
      body.innerHTML = '<div class="muted">No sessions found for ' + escapeHtml(selectedDate) + '.</div>';
      return;
    }

    body.className = '';
    body.innerHTML = '<div style="display:grid;gap:1rem;">' +
      projects.map(function (project) {
        const totalTokens = Number(project.totals?.input_tokens || 0) + Number(project.totals?.output_tokens || 0);
        return '<article class="card">' +
          '<div class="page-header" style="margin-bottom:0.75rem;">' +
            '<div>' +
              '<h3 style="margin:0;">' + escapeHtml(projectName(project.cwd, project.project_slug)) + '</h3>' +
              '<p class="muted" style="margin:0.35rem 0 0;" title="' + escapeHtml(project.cwd || '') + '">' + escapeHtml(project.cwd || '') + '</p>' +
            '</div>' +
            '<div class="meta">' + escapeHtml(String((project.sessions || []).length)) + ' sessions</div>' +
          '</div>' +
          '<div class="stats-grid" style="margin-bottom:1rem;">' +
            '<div><span class="muted">Tokens</span><strong>' + escapeHtml(formatNumber(totalTokens)) + '</strong></div>' +
            '<div><span class="muted">Tool calls</span><strong>' + escapeHtml(formatNumber(project.totals?.tool_calls || 0)) + '</strong></div>' +
            '<div><span class="muted">Project slug</span><strong>' + escapeHtml(project.project_slug || 'unknown') + '</strong></div>' +
          '</div>' +
          '<div style="display:grid;gap:0.75rem;">' +
            (project.sessions || []).map(function (session) {
              return '<div style="padding:0.9rem;border:1px dashed var(--border);background:var(--panel-alt);">' +
                '<div class="split" style="margin-bottom:0.45rem;">' +
                  '<span><strong>' + escapeHtml(formatTimestamp(session.started_at)) + '</strong></span>' +
                  '<span>' + statusBadge(session.status) + '</span>' +
                '</div>' +
                '<div class="meta" style="margin-bottom:0.55rem;">Session ' + escapeHtml(String(session.session_id || '').slice(0, 8)) + ' · ' + escapeHtml(formatNumber((session.total_input_tokens || 0) + (session.total_output_tokens || 0))) + ' tokens · ' + escapeHtml(formatNumber(session.tool_calls || 0)) + ' tools</div>' +
                (session.task ? '<div style="margin-bottom:0.5rem;"><div class="card-label">Task</div><div style="white-space:pre-wrap;line-height:1.6;">' + escapeHtml(session.task) + '</div></div>' : '') +
                (session.summary ? '<div><div class="card-label">Summary</div><div style="white-space:pre-wrap;line-height:1.6;">' + escapeHtml(session.summary) + '</div></div>' : '<div class="muted">No summary yet.</div>') +
              '</div>';
            }).join('') +
          '</div>' +
        '</article>';
      }).join('') +
      '<div class="card" style="position:sticky;bottom:0;">' +
        '<div class="split">' +
          '<strong>Total</strong>' +
          '<span>' + escapeHtml(formatNumber(totals.sessions || 0)) + ' sessions · ' + escapeHtml(formatNumber((totals.input_tokens || 0) + (totals.output_tokens || 0))) + ' tokens</span>' +
        '</div>' +
      '</div>' +
    '</div>';
  } catch (error) {
    body.innerHTML = '<div class="muted">Failed to load daily summary.</div>';
  }
}
`
}
