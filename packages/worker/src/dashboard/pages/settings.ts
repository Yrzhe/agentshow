export function createSettingsPage(): string {
  return String.raw`
export async function renderSettingsPage(root) {
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
  const formatDate = (value) => value ? new Date(value).toLocaleString() : 'Never';
  const showToken = (token) => window.alert('Copy this token now. It will only be shown once.\\n\\n' + token);
  const copyText = async (text) => navigator.clipboard.writeText(text);
  const state = { tokens: [], me: null, latestToken: '' };

  async function load() {
    const [meResponse, tokenResponse] = await Promise.all([
      fetch('/api/auth/me', { credentials: 'include' }),
      fetch('/api/auth/tokens', { credentials: 'include' }),
    ]);
    state.me = meResponse.ok ? await meResponse.json() : null;
    state.tokens = tokenResponse.ok ? await tokenResponse.json() : [];
    render();
  }

  async function createToken() {
    const name = window.prompt('Token name', 'default') ?? 'default';
    const response = await fetch('/api/auth/tokens', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const payload = await response.json();
    if (payload.token) {
      state.latestToken = payload.token;
      showToken(payload.token);
      await load();
    }
  }

  async function deleteToken(id) {
    await fetch('/api/auth/tokens/' + encodeURIComponent(id), { method: 'DELETE', credentials: 'include' });
    await load();
  }

  function render() {
    const origin = window.location.origin;
    const daemonConfig = JSON.stringify({
      cloud: { url: origin, token: state.latestToken || '<your API token>' },
      privacy: { level: 1 },
    }, null, 2);

    root.innerHTML = '<section>' +
      '<div class="page-header"><div><h2>Settings</h2><p class="muted">Manage login state and daemon access tokens.</p></div><button class="button" data-action="create-token">Generate token</button></div>' +
      '<div class="split-layout">' +
        '<div class="panel"><h3>Current user</h3>' +
          (state.me
            ? '<p><strong>' + escapeHtml(state.me.github_login) + '</strong></p><p class="muted">' + escapeHtml(state.me.user_id) + '</p>'
            : '<p class="muted">Not logged in.</p>') +
        '</div>' +
        '<div class="panel"><h3>Daemon config</h3><pre class="code-block">' + escapeHtml(daemonConfig) + '</pre><button class="button button--ghost" data-action="copy-config">Copy config</button></div>' +
      '</div>' +
      '<div class="panel"><h3>API tokens</h3>' +
        (state.tokens.length === 0
          ? '<p class="muted">No API tokens yet.</p>'
          : '<div class="token-list">' + state.tokens.map((token) =>
              '<div class="token-row">' +
                '<div><strong>' + escapeHtml(token.name) + '</strong><div class="muted">' + escapeHtml(token.prefix) + '…</div></div>' +
                '<div class="muted">Created ' + escapeHtml(formatDate(token.created_at)) + '<br>Last used ' + escapeHtml(formatDate(token.last_used_at)) + '</div>' +
                '<button class="button button--ghost" data-token-id="' + escapeHtml(token.id) + '">Delete</button>' +
              '</div>',
            ).join('') + '</div>') +
      '</div>' +
    '</section>';

    root.querySelector('[data-action="create-token"]')?.addEventListener('click', createToken);
    root.querySelector('[data-action="copy-config"]')?.addEventListener('click', () => copyText(daemonConfig));
    root.querySelectorAll('[data-token-id]').forEach((button) => {
      button.addEventListener('click', () => deleteToken(button.getAttribute('data-token-id')));
    });
  }

  await load();
}
`
}
