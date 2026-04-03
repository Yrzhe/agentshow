export function createUsagePage(): string {
  return String.raw`
export async function renderUsagePage(root) {
  const formatNumber = (value) => new Intl.NumberFormat().format(Number(value ?? 0));
  const statuses = { active: 0, discovered: 0, ended: 0 };

  root.innerHTML = '<div class="panel"><div class="muted">Loading usage…</div></div>';
  const response = await fetch('/api/sessions', { credentials: 'include' });
  const payload = await response.json();
  const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];

  const totals = sessions.reduce((acc, session) => {
    const input = Number(session.total_input_tokens ?? 0);
    const output = Number(session.total_output_tokens ?? 0);
    const tools = Number(session.tool_calls ?? 0);
    const status = String(session.status ?? 'discovered');
    if (status in statuses) statuses[status] += 1;
    acc.sessions += 1;
    acc.tokens += input + output;
    acc.tools += tools;
    acc.projects.set(session.project_slug, (acc.projects.get(session.project_slug) ?? 0) + input + output);
    return acc;
  }, { sessions: 0, tokens: 0, tools: 0, projects: new Map() });

  const topProjects = [...totals.projects.entries()].sort((left, right) => right[1] - left[1]).slice(0, 5);
  const maxTokens = topProjects[0]?.[1] ?? 1;

  root.innerHTML = '<section>' +
    '<div class="page-header"><div><h2>Usage</h2><p class="muted">Token and tool activity across synced sessions.</p></div></div>' +
    '<div class="card-grid">' +
      '<div class="panel"><span class="muted">Total sessions</span><h3>' + formatNumber(totals.sessions) + '</h3></div>' +
      '<div class="panel"><span class="muted">Total tokens</span><h3>' + formatNumber(totals.tokens) + '</h3></div>' +
      '<div class="panel"><span class="muted">Tool calls</span><h3>' + formatNumber(totals.tools) + '</h3></div>' +
    '</div>' +
    '<div class="split-layout">' +
      '<div class="panel"><h3>Top projects</h3>' +
        (topProjects.length === 0
          ? '<p class="muted">No session data yet.</p>'
          : '<div class="chart-list">' + topProjects.map(([slug, tokens]) =>
              '<div class="chart-row">' +
                '<div class="chart-row__label"><span>' + slug + '</span><strong>' + formatNumber(tokens) + '</strong></div>' +
                '<div class="chart-bar"><div class="chart-bar__fill" style="width:' + Math.max(8, Math.round(tokens / maxTokens * 100)) + '%"></div></div>' +
              '</div>',
            ).join('') + '</div>') +
      '</div>' +
      '<div class="panel"><h3>Status breakdown</h3><div class="stats-grid">' +
        '<div><span class="muted">Active</span><strong>' + formatNumber(statuses.active) + '</strong></div>' +
        '<div><span class="muted">Discovered</span><strong>' + formatNumber(statuses.discovered) + '</strong></div>' +
        '<div><span class="muted">Ended</span><strong>' + formatNumber(statuses.ended) + '</strong></div>' +
      '</div></div>' +
    '</div>' +
  '</section>';
}
`
}
