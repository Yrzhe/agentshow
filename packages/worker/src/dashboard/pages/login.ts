export function createLoginPage(): string {
  return String.raw`
export function renderLoginPage(root) {
  root.innerHTML = '<section class="login-shell">' +
    '<div class="login-card">' +
      '<div class="login-mark">AS</div>' +
      '<h1>AgentShow</h1>' +
      '<p class="muted">Private cloud dashboard for your local AI agent sessions.</p>' +
      '<a class="button button--primary login-button" href="/api/auth/github">Login with GitHub</a>' +
      '<p class="muted login-footer"><a href="https://github.com/yrzhe/agentshow" target="_blank" rel="noreferrer">Deploy your own AgentShow</a></p>' +
    '</div>' +
  '</section>';
}
`
}
