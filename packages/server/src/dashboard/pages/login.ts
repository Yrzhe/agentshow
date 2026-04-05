export function createLoginPage(): string {
  return String.raw`
export function renderLoginPage(root) {
  root.innerHTML = '<section class="login-shell">' +
    '<div class="login-card">' +
      '<div class="login-mark">AS</div>' +
      '<h1>AgentShow</h1>' +
      '<p class="muted">Private cloud dashboard for your local AI agent sessions.</p>' +
      '<a class="button button--primary login-button" href="/api/auth/github">Login with GitHub</a>' +
      '<div class="login-divider"><span>or</span></div>' +
      '<form id="email-login-form" class="email-login-form">' +
        '<input type="email" id="email-input" placeholder="Enter your email" required />' +
        '<button type="submit" class="button button--secondary">Send magic link</button>' +
      '</form>' +
      '<p id="email-status" class="muted" style="display:none"></p>' +
      '<p class="muted login-footer"><a href="https://github.com/yrzhe/agentshow" target="_blank" rel="noreferrer">Deploy your own AgentShow</a></p>' +
    '</div>' +
  '</section>';

  var form = document.getElementById('email-login-form');
  var status = document.getElementById('email-status');
  if (form) {
    form.addEventListener('submit', function(e) {
      e.preventDefault();
      var email = document.getElementById('email-input').value;
      status.style.display = 'block';
      status.textContent = 'Sending...';
      fetch('/api/auth/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email })
      }).then(function(r) { return r.json(); }).then(function(data) {
        if (data.status === 'sent') {
          status.textContent = 'Check your email for a sign-in link!';
          status.style.color = 'var(--green)';
        } else {
          status.textContent = data.error || 'Failed to send';
          status.style.color = 'var(--danger)';
        }
      }).catch(function() {
        status.textContent = 'Network error';
        status.style.color = 'var(--danger)';
      });
    });
  }
}
`
}
