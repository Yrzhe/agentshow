export function createProjectsPage(): string {
  return String.raw`
export async function renderProjectsPage(root) {
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
  const formatNumber = (value) => new Intl.NumberFormat().format(Number(value ?? 0));
  const relativeTime = (value) => {
    const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000);
    if (!Number.isFinite(seconds)) return 'unknown';
    const steps = [[60, 'second'], [60, 'minute'], [24, 'hour'], [7, 'day'], [4.345, 'week'], [12, 'month']];
    let delta = Math.abs(seconds);
    let unit = 'year';
    for (const [limit, nextUnit] of steps) {
      if (delta < limit) break;
      delta /= limit;
      unit = nextUnit;
    }
    const rounded = Math.max(1, Math.round(delta));
    return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(-rounded, unit);
  };

  root.innerHTML = '<div class="panel"><div class="muted">Loading projects…</div></div>';
  const response = await fetch('/api/projects', { credentials: 'include' });
  const payload = await response.json();
  const projects = Array.isArray(payload.projects) ? payload.projects : [];

  projects.sort((a, b) => {
    const aActive = Number(a.active_sessions) > 0 ? 1 : 0;
    const bActive = Number(b.active_sessions) > 0 ? 1 : 0;
    if (aActive !== bActive) return bActive - aActive;
    return new Date(b.last_activity || 0).getTime() - new Date(a.last_activity || 0).getTime();
  });

  root.innerHTML = projects.length === 0
    ? '<section class="panel"><h2>Projects</h2><p class="muted">No synced projects yet.</p></section>'
    : '<section><div class="page-header"><div><h2>Projects</h2><p class="muted">Overview of synced workspaces and activity.</p></div></div><div class="card-grid">' + projects.map((project) => {
        const slug = String(project.project_slug ?? '');
        const displaySlug = slug.length > 28 ? slug.slice(0, 12) + '…' + slug.slice(-12) : slug;
        const totalTokens = Number(project.total_input_tokens ?? 0) + Number(project.total_output_tokens ?? 0);
        const isActive = Number(project.active_sessions) > 0;
        const statusHtml = isActive
          ? '<span class="badge active">' + formatNumber(project.active_sessions) + ' active</span>'
          : '<span class="badge ended">ended</span>';
        return '<a class="panel project-card" href="#/?project=' + encodeURIComponent(slug) + '">' +
          '<div class="project-card__top"><span class="project-card__slug">' + escapeHtml(displaySlug) + '</span>' + statusHtml + '</div>' +
          '<p class="muted project-card__cwd" title="' + escapeHtml(project.cwd) + '">' + escapeHtml(project.cwd) + '</p>' +
          '<div class="project-stats">' +
            '<div><span class="muted">Sessions</span><strong>' + formatNumber(project.total_sessions) + '</strong></div>' +
            '<div><span class="muted">Tokens</span><strong>' + formatNumber(totalTokens) + '</strong></div>' +
            '<div><span class="muted">Updated</span><strong>' + escapeHtml(relativeTime(project.last_activity)) + '</strong></div>' +
          '</div>' +
        '</a>';
      }).join('') + '</div></section>';
}
`
}
