import { sessionDetailPageJs } from './pages/session-detail.js'
import { createAuditPage } from './pages/audit.js'
import { createBudgetPage } from './pages/budget.js'
import { createCostAttributionPage } from './pages/cost-attribution.js'
import { sessionsPageJs } from './pages/sessions.js'
import { createDailySummaryPage } from './pages/daily-summary.js'
import { createProjectsPage } from './pages/projects.js'
import { createReplayPage } from './pages/replay.js'
import { searchPageJs } from './pages/search.js'
import { createSettingsPage } from './pages/settings.js'
import { createTeamsPage } from './pages/teams.js'
import { createUsagePage } from './pages/usage.js'
import { createWebhooksPage } from './pages/webhooks.js'
import { createWorkflowsPage } from './pages/workflows.js'

export const appJs = `const appRoot = document.getElementById('app')
let cleanup = null
let currentUser = null

window.addEventListener('hashchange', renderApp)
window.addEventListener('load', renderApp)

async function renderApp() {
  if (cleanup) {
    cleanup()
    cleanup = null
  }

  const route = parseRoute(location.hash || '#/')
  const requiresAuth = route.name !== 'login'
  currentUser = requiresAuth ? await getCurrentUser() : null

  if (requiresAuth && !currentUser) {
    location.hash = '#/login'
    return
  }

  const shell = document.createElement('div')
  shell.className = 'shell'
  shell.appendChild(renderNav(route))
  const content = document.createElement('main')
  content.className = 'content'
  content.appendChild(await renderRoute(route))
  shell.appendChild(content)
  appRoot.replaceChildren(shell)
}

function renderNav(route) {
  const aside = document.createElement('aside')
  aside.className = 'sidebar'

  const navGroups = [
    { label: 'Monitor', items: [
      ['#/', 'Sessions'],
      ['#/daily-summary', 'Daily Summary'],
      ['#/replay', 'Session Replay'],
    ]},
    { label: 'Analyze', items: [
      ['#/search', 'Search'],
      ['#/projects', 'Projects'],
      ['#/usage', 'Usage'],
      ['#/cost', 'Cost Attribution'],
    ]},
    { label: 'Manage', items: [
      ['#/teams', 'Teams'],
      ['#/budget', 'Budget'],
      ['#/webhooks', 'Webhooks'],
      ['#/workflows', 'Workflows'],
    ]},
    { label: 'System', items: [
      ['#/audit', 'Audit Log'],
      ['#/settings', 'Settings'],
    ]},
  ]

  var html = '<div class="sidebar-header"><div class="brand">AGENTSHOW<small>' + escapeHtml(currentUser?.github_login || currentUser?.email || 'Dashboard') + '</small></div><button class="sidebar-toggle" aria-label="Menu">&#9776;</button></div>'

  navGroups.forEach(function (group) {
    html += '<div class="nav-group"><div class="nav-group-label">' + escapeHtml(group.label) + '</div><nav class="nav">'
    group.items.forEach(function (item) {
      var isActive = false
      var routeName = item[0].slice(2).split('/')[0] || 'home'
      if (route.name === routeName) isActive = true
      if (item[0] === '#/' && route.name === 'home') isActive = true
      if (item[0] === '#/teams' && route.name === 'team') isActive = true
      if (item[0] === '#/replay' && route.name === 'replay') isActive = true
      html += '<a href="' + item[0] + '"' + (isActive ? ' class="active"' : '') + '>' + escapeHtml(item[1]) + '</a>'
    })
    html += '</nav></div>'
  })

  aside.innerHTML = html
  var backdrop = document.createElement('div')
  backdrop.className = 'sidebar-backdrop'
  function openSidebar() {
    aside.classList.add('open')
    backdrop.classList.add('visible')
    document.body.style.overflow = 'hidden'
  }
  function closeSidebar() {
    aside.classList.remove('open')
    backdrop.classList.remove('visible')
    document.body.style.overflow = ''
  }
  aside.querySelector('.sidebar-toggle').addEventListener('click', function () {
    if (aside.classList.contains('open')) closeSidebar()
    else openSidebar()
  })
  backdrop.addEventListener('click', closeSidebar)
  aside.querySelectorAll('.nav a').forEach(function (link) {
    link.addEventListener('click', closeSidebar)
  })
  aside.appendChild(backdrop)
  return aside
}

async function renderRoute(route) {
  const context = {
    route: route,
    user: currentUser,
    setCleanup: function (value) { cleanup = value },
  }

  if (route.name === 'login') return renderLoginPage()
  if (route.name === 'daily-summary') { var d = document.createElement('div'); await renderDailySummaryPage(d); return d }
  if (route.name === 'search') return renderSearchPage(context)
  if (route.name === 'replay') {
    if (route.params[0]) { var r = document.createElement('div'); await renderReplayPage(r, route.params[0]); return r }
    return renderReplayListPage()
  }
  if (route.name === 'session') return renderSessionDetailPage(context)
  if (route.name === 'projects') { var p = document.createElement('div'); await renderProjectsPage(p); return p }
  if (route.name === 'teams') { var t = document.createElement('div'); await renderTeamsPage(t); return t }
  if (route.name === 'team') { var td = document.createElement('div'); await renderTeamDetailPage(td, route.params[0], route.query); return td }
  if (route.name === 'usage') { var u = document.createElement('div'); await renderUsagePage(u); return u }
  if (route.name === 'budget') { var b = document.createElement('div'); await renderBudgetPage(b); return b }
  if (route.name === 'cost') { var ca = document.createElement('div'); await renderCostAttributionPage(ca); return ca }
  if (route.name === 'webhooks') { var w = document.createElement('div'); await renderWebhooksPage(w); return w }
  if (route.name === 'workflows') { var wf = document.createElement('div'); await renderWorkflowsPage(wf); return wf }
  if (route.name === 'audit') { var a = document.createElement('div'); await renderAuditPage(a); return a }
  if (route.name === 'settings') { var s = document.createElement('div'); await renderSettingsPage(s); return s }
  return renderSessionsPage(context)
}

async function api(path) {
  const response = await fetch('/api' + path, { credentials: 'include' })
  if (response.status === 401) throw new Error('unauthorized')
  if (!response.ok) throw new Error('Request failed: ' + response.status)
  return response.json()
}

async function getCurrentUser() {
  try {
    return await api('/auth/me')
  } catch (error) {
    return null
  }
}

function renderLoginPage() {
  const wrapper = document.createElement('section')
  wrapper.className = 'login'
  wrapper.innerHTML = [
    '<div class="card" style="max-width:400px;margin:80px auto;text-align:center;padding:2rem;">',
    '  <h1 style="margin:0 0 4px;font-size:18px;text-transform:uppercase;letter-spacing:0.08em;">AgentShow</h1>',
    '  <p class="muted" style="margin-bottom:24px">Sign in to your agent dashboard</p>',
    '  <a href="/api/auth/github" style="display:block;padding:10px;background:var(--text);color:var(--bg);text-decoration:none;margin-bottom:16px;font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:0.04em;">Login with GitHub</a>',
    '  <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px"><hr style="flex:1;border:none;border-top:1px dashed var(--border)"><span class="muted" style="font-size:11px;">or</span><hr style="flex:1;border:none;border-top:1px dashed var(--border)"></div>',
    '  <div id="email-step-1">',
    '    <form id="email-form" style="display:flex;gap:8px">',
    '      <input id="email-input" type="email" placeholder="your@email.com" required style="flex:1;">',
    '      <button type="submit">Send code</button>',
    '    </form>',
    '  </div>',
    '  <div id="email-step-2" style="display:none">',
    '    <p class="muted" style="margin-bottom:8px;font-size:12px;">Enter the 6-digit code sent to <strong id="sent-to-email"></strong></p>',
    '    <form id="code-form" style="display:flex;gap:8px">',
    '      <input id="code-input" type="text" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="000000" required style="flex:1;text-align:center;font-size:20px;letter-spacing:4px;">',
    '      <button type="submit" style="background:var(--green);color:#fff;border-color:var(--green);">Verify</button>',
    '    </form>',
    '    <a href="#" id="back-to-email" style="display:inline-block;margin-top:8px;font-size:11px;color:var(--muted);">Use a different email</a>',
    '  </div>',
    '  <p id="email-status" class="muted" style="margin-top:12px;display:none;font-size:12px;"></p>',
    '</div>',
  ].join('')

  setTimeout(function() {
    var step1 = document.getElementById('email-step-1')
    var step2 = document.getElementById('email-step-2')
    var status = document.getElementById('email-status')
    var sentTo = document.getElementById('sent-to-email')
    var currentEmail = ''

    var emailForm = document.getElementById('email-form')
    if (emailForm) {
      emailForm.addEventListener('submit', function(e) {
        e.preventDefault()
        currentEmail = document.getElementById('email-input').value
        status.style.display = 'block'
        status.textContent = 'Sending code...'
        status.style.color = 'var(--muted)'
        fetch('/api/auth/email/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: currentEmail })
        }).then(function(r) { return r.json() }).then(function(data) {
          if (data.status === 'sent') {
            step1.style.display = 'none'
            step2.style.display = 'block'
            sentTo.textContent = currentEmail
            status.textContent = 'Code sent! Check your inbox.'
            status.style.color = 'var(--green)'
          } else {
            status.textContent = data.error || 'Failed to send'
            status.style.color = 'var(--danger)'
          }
        }).catch(function() {
          status.textContent = 'Network error'
          status.style.color = 'var(--danger)'
        })
      })
    }

    var codeForm = document.getElementById('code-form')
    if (codeForm) {
      codeForm.addEventListener('submit', function(e) {
        e.preventDefault()
        var code = document.getElementById('code-input').value
        status.textContent = 'Verifying...'
        status.style.color = 'var(--muted)'
        fetch('/api/auth/email/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: currentEmail, code: code })
        }).then(function(r) { return r.json() }).then(function(data) {
          if (data.status === 'ok') {
            location.hash = '#/'
            location.reload()
          } else {
            status.textContent = data.error || 'Invalid code'
            status.style.color = 'var(--danger)'
          }
        }).catch(function() {
          status.textContent = 'Network error'
          status.style.color = 'var(--danger)'
        })
      })
    }

    var backLink = document.getElementById('back-to-email')
    if (backLink) {
      backLink.addEventListener('click', function(e) {
        e.preventDefault()
        step1.style.display = 'block'
        step2.style.display = 'none'
        status.style.display = 'none'
      })
    }
  }, 0)

  return wrapper
}

async function renderReplayListPage() {
  var data = await api('/sessions?status=ended')
  var sessions = Array.isArray(data.sessions) ? data.sessions.slice(0, 20) : []
  var page = document.createElement('section')
  page.innerHTML = [
    '<div class="page-header"><div><h1>Session Replay</h1><p>Select a session to replay its conversation.</p></div></div>',
    '<div class="table-wrap"><table>',
    '<thead><tr><th>Session</th><th>Project</th><th>Started</th><th>Tokens</th><th></th></tr></thead>',
    '<tbody id="replay-list-body"></tbody>',
    '</table></div>',
  ].join('')
  var body = page.querySelector('#replay-list-body')
  sessions.forEach(function (s) {
    var row = document.createElement('tr')
    row.innerHTML = [
      '<td><strong>' + escapeHtml(String(s.session_id).slice(0, 8)) + '</strong></td>',
      '<td>' + escapeHtml(projectName(s.cwd, s.project_slug)) + '</td>',
      '<td>' + escapeHtml(relativeTime(s.started_at)) + '</td>',
      '<td>' + escapeHtml(formatNumber((s.total_input_tokens || 0) + (s.total_output_tokens || 0))) + '</td>',
      '<td><a href="#/replay/' + encodeURIComponent(s.session_id) + '" style="text-decoration:none;color:var(--yellow);font-weight:700;font-size:11px;text-transform:uppercase;">Replay</a></td>',
    ].join('')
    body.appendChild(row)
  })
  if (!sessions.length) {
    body.innerHTML = '<tr><td colspan="5" class="muted">No ended sessions available for replay.</td></tr>'
  }
  return page
}

function renderPlaceholderPage(title, description) {
  return renderEmptyState(title, description)
}

function renderEmptyState(title, description) {
  const section = document.createElement('section')
  section.className = 'empty'
  section.innerHTML = '<div class="card" style="padding:2rem;"><h1 style="margin:0 0 0.5rem;">' + escapeHtml(title) + '</h1><p class="muted">' + escapeHtml(description) + '</p></div>'
  return section
}

function parseRoute(hash) {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  const parts = raw.split('?')
  const path = parts[0] || '/'
  const query = Object.fromEntries(new URLSearchParams(parts[1] || ''))
  const replayMatch = path.match(/^\\/replay\\/([^/]+)$/)
  const sessionMatch = path.match(/^\\/session\\/([^/]+)$/)
  const teamMatch = path.match(/^\\/team\\/([^/]+)$/)
  if (path === '/login') return { name: 'login', params: [], query: query }
  if (path === '/daily-summary') return { name: 'daily-summary', params: [], query: query }
  if (path === '/search') return { name: 'search', params: [], query: query }
  if (path === '/projects') return { name: 'projects', params: [], query: query }
  if (path === '/teams') return { name: 'teams', params: [], query: query }
  if (path === '/usage') return { name: 'usage', params: [], query: query }
  if (path === '/budget') return { name: 'budget', params: [], query: query }
  if (path === '/cost') return { name: 'cost', params: [], query: query }
  if (path === '/webhooks') return { name: 'webhooks', params: [], query: query }
  if (path === '/workflows') return { name: 'workflows', params: [], query: query }
  if (path === '/audit') return { name: 'audit', params: [], query: query }
  if (path === '/settings') return { name: 'settings', params: [], query: query }
  if (path === '/replay') return { name: 'replay', params: [], query: query }
  if (replayMatch) return { name: 'replay', params: [decodeURIComponent(replayMatch[1])], query: query }
  if (teamMatch) return { name: 'team', params: [decodeURIComponent(teamMatch[1])], query: query }
  if (sessionMatch) return { name: 'session', params: [decodeURIComponent(sessionMatch[1])], query: query }
  return { name: 'home', params: [], query: query }
}

function setTimedRefresh(interval) {
  const timer = setInterval(function () {
    if (location.hash.startsWith('#/?status=active') || location.hash === '#/' || location.hash === '') renderApp()
  }, interval)
  return function () { clearInterval(timer) }
}

function shortProject(slug) {
  return String(slug || '').replace(/^-+/, '').slice(0, 40) || 'unknown'
}

function projectName(cwd, slug) {
  if (cwd && cwd.length > 1 && !cwd.startsWith('0123456789abcdef')) {
    var parts = String(cwd).split('/').filter(function(p) { return p.length > 0 })
    return parts[parts.length - 1] || shortProject(slug)
  }
  return shortProject(slug)
}

function relativeTime(value) {
  const diff = Date.now() - new Date(value).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return minutes + 'm ago'
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return hours + 'h ago'
  const days = Math.floor(hours / 24)
  return days + 'd ago'
}

function sessionDuration(startedAt, lastSeenAt) {
  const diff = Math.max(0, new Date(lastSeenAt).getTime() - new Date(startedAt).getTime())
  const minutes = Math.floor(diff / 60000)
  if (minutes < 60) return minutes + 'm'
  const hours = Math.floor(minutes / 60)
  const rem = minutes % 60
  return hours + 'h ' + rem + 'm'
}

function formatTimestamp(value) {
  const date = new Date(value)
  return date.toLocaleString()
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(Number(value || 0))
}

function truncate(value, limit) {
  return value.length > limit ? value.slice(0, limit - 1) + '…' : value
}

function statusBadge(status) {
  const safe = String(status || 'ended')
  return '<span class="badge ' + escapeHtml(safe) + '">' + escapeHtml(safe) + '</span>'
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

${sessionsPageJs}
${searchPageJs}
${sessionDetailPageJs}
${createDailySummaryPage()}
${createProjectsPage()}
${createReplayPage()}
${createSettingsPage()}
${createTeamsPage()}
${createUsagePage()}
${createBudgetPage()}
${createCostAttributionPage()}
${createWebhooksPage()}
${createWorkflowsPage()}
${createAuditPage()}
`
