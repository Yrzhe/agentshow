import { sessionDetailPageJs } from './pages/session-detail.js'
import { createBudgetPage } from './pages/budget.js'
import { createCostAttributionPage } from './pages/cost-attribution.js'
import { sessionsPageJs } from './pages/sessions.js'
import { createDailySummaryPage } from './pages/daily-summary.js'
import { createProjectsPage } from './pages/projects.js'
import { searchPageJs } from './pages/search.js'
import { createSettingsPage } from './pages/settings.js'
import { createTeamsPage } from './pages/teams.js'
import { createUsagePage } from './pages/usage.js'
import { createWebhooksPage } from './pages/webhooks.js'

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
  const navItems = [
    ['#/', 'Sessions'],
    ['#/daily-summary', 'Daily Summary'],
    ['#/search', 'Search'],
    ['#/projects', 'Projects'],
    ['#/teams', 'Teams'],
    ['#/usage', 'Usage'],
    ['#/budget', 'Budget'],
    ['#/cost', 'Cost Attribution'],
    ['#/webhooks', 'Webhooks'],
    ['#/settings', 'Settings'],
  ]
  aside.innerHTML = '<div class="brand">AgentShow<small>' + escapeHtml(currentUser?.github_login || 'Dashboard') + '</small></div><nav class="nav"></nav>'
  const nav = aside.querySelector('.nav')
  navItems.forEach(function (item) {
    const link = document.createElement('a')
    link.href = item[0]
    link.textContent = item[1]
    if (
      route.name === item[0].slice(2).split('/')[0]
      || (item[0] === '#/' && route.name === 'home')
      || (item[0] === '#/teams' && route.name === 'team')
    ) {
      link.classList.add('active')
    }
    nav.appendChild(link)
  })
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
  if (route.name === 'session') return renderSessionDetailPage(context)
  if (route.name === 'projects') { var p = document.createElement('div'); await renderProjectsPage(p); return p }
  if (route.name === 'teams') { var t = document.createElement('div'); await renderTeamsPage(t); return t }
  if (route.name === 'team') { var td = document.createElement('div'); await renderTeamDetailPage(td, route.params[0], route.query); return td }
  if (route.name === 'usage') { var u = document.createElement('div'); await renderUsagePage(u); return u }
  if (route.name === 'budget') { var b = document.createElement('div'); await renderBudgetPage(b); return b }
  if (route.name === 'cost') { var ca = document.createElement('div'); await renderCostAttributionPage(ca); return ca }
  if (route.name === 'webhooks') { var w = document.createElement('div'); await renderWebhooksPage(w); return w }
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
    '<div class="card" style="max-width:380px;margin:80px auto;text-align:center">',
    '  <h1 style="margin-bottom:4px">AgentShow</h1>',
    '  <p class="muted" style="margin-bottom:24px">Sign in to your agent dashboard</p>',
    '  <a href="/api/auth/github" style="display:block;padding:10px;background:#238636;color:#fff;border-radius:6px;text-decoration:none;margin-bottom:16px">Login with GitHub</a>',
    '  <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px"><hr style="flex:1;border:none;border-top:1px solid #30363d"><span class="muted">or</span><hr style="flex:1;border:none;border-top:1px solid #30363d"></div>',
    '  <div id="email-step-1">',
    '    <form id="email-form" style="display:flex;gap:8px">',
    '      <input id="email-input" type="email" placeholder="your@email.com" required style="flex:1;padding:8px 12px;background:#0d1117;border:1px solid #30363d;border-radius:6px;color:#e6edf3">',
    '      <button type="submit" style="padding:8px 16px;background:#21262d;color:#e6edf3;border:1px solid #30363d;border-radius:6px;cursor:pointer">Send code</button>',
    '    </form>',
    '  </div>',
    '  <div id="email-step-2" style="display:none">',
    '    <p class="muted" style="margin-bottom:8px">Enter the 6-digit code sent to <strong id="sent-to-email"></strong></p>',
    '    <form id="code-form" style="display:flex;gap:8px">',
    '      <input id="code-input" type="text" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="000000" required style="flex:1;padding:8px 12px;background:#0d1117;border:1px solid #30363d;border-radius:6px;color:#e6edf3;text-align:center;font-size:20px;letter-spacing:4px;font-family:monospace">',
    '      <button type="submit" style="padding:8px 16px;background:#238636;color:#fff;border:1px solid #238636;border-radius:6px;cursor:pointer">Verify</button>',
    '    </form>',
    '    <a href="#" id="back-to-email" style="display:inline-block;margin-top:8px;font-size:12px;color:#8b949e">Use a different email</a>',
    '  </div>',
    '  <p id="email-status" class="muted" style="margin-top:12px;display:none"></p>',
    '  <p class="muted" style="margin-top:24px;font-size:12px"><a href="https://github.com/yrzhe/agentshow" target="_blank" style="color:#8b949e">Deploy your own AgentShow</a></p>',
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
        status.style.color = '#8b949e'
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
            status.style.color = '#3fb950'
          } else {
            status.textContent = data.error || 'Failed to send'
            status.style.color = '#f85149'
          }
        }).catch(function() {
          status.textContent = 'Network error'
          status.style.color = '#f85149'
        })
      })
    }

    var codeForm = document.getElementById('code-form')
    if (codeForm) {
      codeForm.addEventListener('submit', function(e) {
        e.preventDefault()
        var code = document.getElementById('code-input').value
        status.textContent = 'Verifying...'
        status.style.color = '#8b949e'
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
            status.style.color = '#f85149'
          }
        }).catch(function() {
          status.textContent = 'Network error'
          status.style.color = '#f85149'
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

function renderPlaceholderPage(title, description) {
  return renderEmptyState(title, description)
}

function renderEmptyState(title, description) {
  const section = document.createElement('section')
  section.className = 'empty'
  section.innerHTML = '<div class="card"><h1>' + escapeHtml(title) + '</h1><p class="muted">' + escapeHtml(description) + '</p></div>'
  return section
}

function parseRoute(hash) {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  const parts = raw.split('?')
  const path = parts[0] || '/'
  const query = Object.fromEntries(new URLSearchParams(parts[1] || ''))
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
  if (path === '/settings') return { name: 'settings', params: [], query: query }
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
${createSettingsPage()}
${createTeamsPage()}
${createUsagePage()}
${createBudgetPage()}
${createCostAttributionPage()}
${createWebhooksPage()}
`
