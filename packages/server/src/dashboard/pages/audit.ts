export function createAuditPage(): string {
  return String.raw`
export async function renderAuditPage(root) {
  const state = { logs: [], stats: [], fileHistory: [], filters: { action_type: '', project: '', file: '' } };
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));

  async function load() {
    const query = new URLSearchParams();
    if (state.filters.action_type) query.set('action_type', state.filters.action_type);
    if (state.filters.project) query.set('project', state.filters.project);
    if (state.filters.file) query.set('file', state.filters.file);
    const [logsResponse, statsResponse] = await Promise.all([
      fetch('/api/audit?' + query.toString(), { credentials: 'include' }),
      fetch('/api/audit/stats?days=30', { credentials: 'include' }),
    ]);
    state.logs = (await logsResponse.json()).logs || [];
    state.stats = (await statsResponse.json()).stats || [];
    render();
  }

  async function loadFileHistory(path) {
    const response = await fetch('/api/audit/file?path=' + encodeURIComponent(path), { credentials: 'include' });
    state.fileHistory = (await response.json()).logs || [];
    render();
  }

  function render() {
    const projectOptions = [...new Set(state.logs.map((log) => log.project_slug).filter(Boolean))];
    root.innerHTML = '<section><div class="page-header"><div><h2>Audit Log</h2><p class="muted">Trace file edits, commands, and agent actions across sessions.</p></div></div>' +
      '<div class="card-grid">' + state.stats.map((item) => '<div class="panel"><span class="muted">' + escapeHtml(item.action_type) + '</span><h3>' + escapeHtml(item.count) + '</h3></div>').join('') + '</div>' +
      '<div class="panel" style="margin-top:16px"><form id="audit-filters" style="display:flex;gap:12px;flex-wrap:wrap">' +
      '<select name="action_type" style="padding:8px 10px;background:#0d1117;border:1px solid #30363d;border-radius:6px;color:#e6edf3"><option value="">All actions</option>' + ['file_edit','file_create','file_delete','command_exec','pr_create','pr_merge','git_push','tool_call','error'].map((value) => '<option value="' + value + '"' + (state.filters.action_type === value ? ' selected' : '') + '>' + value + '</option>').join('') + '</select>' +
      '<select name="project" style="padding:8px 10px;background:#0d1117;border:1px solid #30363d;border-radius:6px;color:#e6edf3"><option value="">All projects</option>' + projectOptions.map((value) => '<option value="' + escapeHtml(value) + '"' + (state.filters.project === value ? ' selected' : '') + '>' + escapeHtml(value) + '</option>').join('') + '</select>' +
      '<input name="file" placeholder="File path" value="' + escapeHtml(state.filters.file) + '" style="padding:8px 10px;background:#0d1117;border:1px solid #30363d;border-radius:6px;color:#e6edf3">' +
      '<button class="button" type="submit">Filter</button></form></div>' +
      '<div class="panel" style="margin-top:16px"><table style="width:100%;border-collapse:collapse"><thead><tr><th align="left">Time</th><th align="left">Session</th><th align="left">Action</th><th align="left">Detail</th><th align="left">File</th></tr></thead><tbody>' +
      state.logs.map((log) => '<tr><td style="padding:8px 0;border-top:1px solid #30363d">' + escapeHtml(new Date(log.timestamp).toLocaleString()) + '</td><td style="padding:8px 0;border-top:1px solid #30363d"><a href="#/session/' + encodeURIComponent(log.session_id) + '">' + escapeHtml(log.session_id) + '</a></td><td style="padding:8px 0;border-top:1px solid #30363d"><span class="badge active">' + escapeHtml(log.action_type) + '</span></td><td style="padding:8px 0;border-top:1px solid #30363d">' + escapeHtml(log.action_detail || '') + '</td><td style="padding:8px 0;border-top:1px solid #30363d">' + (log.file_path ? '<button class="button button--ghost" type="button" data-file-path="' + escapeHtml(log.file_path) + '">' + escapeHtml(log.file_path) + '</button>' : '') + '</td></tr>').join('') +
      '</tbody></table></div>' +
      (state.fileHistory.length ? '<div class="panel" style="margin-top:16px"><h3>File History</h3>' + state.fileHistory.map((log) => '<div style="padding:8px 0;border-top:1px solid #30363d"><strong>' + escapeHtml(log.action_type) + '</strong> <span class="muted">' + escapeHtml(new Date(log.timestamp).toLocaleString()) + '</span><div>' + escapeHtml(log.action_detail || '') + '</div></div>').join('') + '</div>' : '') +
      '</section>';

    root.querySelector('#audit-filters')?.addEventListener('submit', async function (event) {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      state.filters = { action_type: String(form.get('action_type') || ''), project: String(form.get('project') || ''), file: String(form.get('file') || '') };
      await load();
    });
    root.querySelectorAll('[data-file-path]').forEach((button) => button.addEventListener('click', async function () {
      await loadFileHistory(button.getAttribute('data-file-path'));
    }));
  }

  await load();
}
`
}
