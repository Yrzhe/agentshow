export function createWebhooksPage(): string {
  return String.raw`
export async function renderWebhooksPage(root) {
  const EVENTS = ['session.ended', 'test'];
  const state = { webhooks: [], deliveries: {}, editingId: null, form: { name: 'Default', url: '', secret: '', events: ['session.ended'], is_active: true }, status: '' };
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
  const formatDate = (value) => value ? new Date(value).toLocaleString() : 'Never';

  function latestLabel(hook) {
    const delivery = hook.latest_delivery;
    if (!delivery) return '<span class="muted">No deliveries yet</span>';
    return '<span style="color:' + (delivery.success ? 'var(--green)' : 'var(--danger)') + '">' + escapeHtml(delivery.event_type) + ' · ' + escapeHtml(String(delivery.status_code ?? 'ERR')) + '</span>';
  }

  function resetForm() {
    state.editingId = null;
    state.form = { name: 'Default', url: '', secret: '', events: ['session.ended'], is_active: true };
  }

  function setFormFromWebhook(webhook) {
    state.editingId = webhook.id;
    state.form = {
      name: webhook.name || 'Default',
      url: webhook.url || '',
      secret: webhook.secret || '',
      events: String(webhook.events || 'session.ended').split(',').map((item) => item.trim()).filter(Boolean),
      is_active: Boolean(webhook.is_active),
    };
  }

  async function load() {
    const response = await fetch('/api/webhooks', { credentials: 'include' });
    const payload = await response.json();
    state.webhooks = Array.isArray(payload.webhooks) ? payload.webhooks : [];
    render();
  }

  async function saveWebhook() {
    const method = state.editingId ? 'PUT' : 'POST';
    const path = state.editingId ? '/api/webhooks/' + state.editingId : '/api/webhooks';
    const response = await fetch(path, {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: state.form.name,
        url: state.form.url,
        secret: state.form.secret || null,
        events: state.form.events,
        is_active: state.form.is_active,
      }),
    });
    if (!response.ok) throw new Error('save failed');
    state.status = state.editingId ? 'Webhook updated.' : 'Webhook created.';
    resetForm();
    await load();
  }

  async function runAction(path, options, message) {
    const response = await fetch(path, { credentials: 'include', ...options });
    if (!response.ok) throw new Error('request failed');
    state.status = message;
    await load();
  }

  async function toggleHistory(id) {
    if (state.deliveries[id]) {
      delete state.deliveries[id];
      render();
      return;
    }
    const response = await fetch('/api/webhooks/' + id + '/deliveries?limit=10', { credentials: 'include' });
    const payload = await response.json();
    state.deliveries[id] = Array.isArray(payload.deliveries) ? payload.deliveries : [];
    render();
  }

  function renderDeliveries(id) {
    const deliveries = state.deliveries[id];
    if (!deliveries) return '';
    if (deliveries.length === 0) return '<div class="panel" style="margin-top:12px"><p class="muted" style="margin:0">No delivery history.</p></div>';
    return '<div class="panel" style="margin-top:12px"><h4 style="margin-bottom:12px">Recent deliveries</h4>' + deliveries.map((delivery) =>
      '<div style="padding:10px 0;border-top:1px solid var(--border)">' +
      '<div style="display:flex;justify-content:space-between;gap:12px"><strong>' + escapeHtml(delivery.event_type) + '</strong><span style="color:' + (delivery.success ? 'var(--green)' : 'var(--danger)') + '">' + escapeHtml(String(delivery.status_code ?? 'ERR')) + '</span></div>' +
      '<div class="muted" style="margin:6px 0">' + escapeHtml(formatDate(delivery.attempted_at)) + '</div>' +
      '<pre class="code-block" style="margin:0">' + escapeHtml(delivery.response_body || '') + '</pre>' +
      '</div>'
    ).join('') + '</div>';
  }

  function render() {
    const eventsMarkup = EVENTS.map((event) => '<label style="display:flex;align-items:center;gap:8px"><input type="checkbox" name="events" value="' + event + '"' + (state.form.events.includes(event) ? ' checked' : '') + '><span>' + event + '</span></label>').join('');
    root.innerHTML = '<section>' +
      '<div class="page-header"><div><h2>Webhooks</h2><p class="muted">Send session-ended events to Slack, Discord, Feishu, or any HTTP endpoint.</p></div></div>' +
      '<div class="split-layout">' +
      '<div class="panel"><h3 style="margin-bottom:12px">Configured webhooks</h3>' +
      (state.webhooks.length === 0 ? '<p class="muted">No webhooks configured yet.</p>' : state.webhooks.map((hook) =>
        '<div class="panel" style="margin-bottom:12px;padding:12px;background:var(--bg)">' +
        '<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start"><div><strong>' + escapeHtml(hook.name) + '</strong><div class="muted">' + escapeHtml(hook.url) + '</div><div class="muted" style="margin-top:6px">' + latestLabel(hook) + '</div></div><span class="badge ' + (hook.is_active ? 'active' : 'ended') + '">' + (hook.is_active ? 'active' : 'inactive') + '</span></div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button class="button button--ghost" data-action="edit" data-id="' + hook.id + '">Edit</button><button class="button button--ghost" data-action="toggle" data-id="' + hook.id + '">' + (hook.is_active ? 'Disable' : 'Enable') + '</button><button class="button button--ghost" data-action="test" data-id="' + hook.id + '">Test</button><button class="button button--ghost" data-action="history" data-id="' + hook.id + '">History</button><button class="button button--ghost" data-action="delete" data-id="' + hook.id + '">Delete</button></div>' +
        renderDeliveries(hook.id) + '</div>'
      ).join('')) + '</div>' +
      '<div class="panel"><h3>' + (state.editingId ? 'Edit webhook' : 'Add webhook') + '</h3><p class="muted">Secret is sent as <code>X-Webhook-Secret</code>.</p>' +
      '<form id="webhook-form" style="display:grid;gap:12px">' +
      '<label style="display:grid;gap:6px"><span class="muted">Name</span><input name="name" value="' + escapeHtml(state.form.name) + '" style="padding:8px 10px;background:var(--bg);border:1px solid var(--border);border-radius:0;color:var(--text)"></label>' +
      '<label style="display:grid;gap:6px"><span class="muted">URL</span><input name="url" value="' + escapeHtml(state.form.url) + '" placeholder="https://example.com/webhook" style="padding:8px 10px;background:var(--bg);border:1px solid var(--border);border-radius:0;color:var(--text)"></label>' +
      '<label style="display:grid;gap:6px"><span class="muted">Secret</span><input name="secret" value="' + escapeHtml(state.form.secret) + '" placeholder="optional" style="padding:8px 10px;background:var(--bg);border:1px solid var(--border);border-radius:0;color:var(--text)"></label>' +
      '<div style="display:grid;gap:6px"><span class="muted">Events</span><div style="display:grid;gap:8px">' + eventsMarkup + '</div></div>' +
      '<label style="display:flex;align-items:center;gap:8px"><input type="checkbox" name="is_active"' + (state.form.is_active ? ' checked' : '') + '><span>Webhook is active</span></label>' +
      '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button class="button" type="submit">' + (state.editingId ? 'Update webhook' : 'Create webhook') + '</button>' + (state.editingId ? '<button class="button button--ghost" type="button" data-action="cancel-edit">Cancel</button>' : '') + '<span class="muted">' + escapeHtml(state.status) + '</span></div>' +
      '</form></div></div></section>';

    root.querySelector('#webhook-form')?.addEventListener('submit', async function (event) {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      state.form = { name: String(form.get('name') || ''), url: String(form.get('url') || ''), secret: String(form.get('secret') || ''), events: form.getAll('events').map((item) => String(item)), is_active: form.get('is_active') !== null };
      try { await saveWebhook(); } catch (error) { state.status = 'Failed to save webhook.'; render(); }
    });
    root.querySelector('[data-action="cancel-edit"]')?.addEventListener('click', function () { resetForm(); render(); });
    root.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', async function () {
      const action = button.getAttribute('data-action');
      const id = Number(button.getAttribute('data-id'));
      try {
        if (action === 'edit') { const hook = state.webhooks.find((item) => item.id === id); if (hook) { setFormFromWebhook(hook); render(); } }
        if (action === 'toggle') await runAction('/api/webhooks/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_active: Number(!(state.webhooks.find((item) => item.id === id)?.is_active)) }) }, 'Webhook status updated.');
        if (action === 'test') await runAction('/api/webhooks/' + id + '/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: 'test', data: { message: 'Hello from AgentShow' } }) }, 'Test webhook sent.');
        if (action === 'history') await toggleHistory(id);
        if (action === 'delete') await runAction('/api/webhooks/' + id, { method: 'DELETE' }, 'Webhook deleted.');
      } catch (error) { state.status = 'Action failed.'; render(); }
    }));
  }

  await load();
}
`
}
