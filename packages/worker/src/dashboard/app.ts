import { sessionDetailPageJs } from './pages/session-detail.js'
import { sessionsPageJs } from './pages/sessions.js'

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
    ['#/projects', 'Projects'],
    ['#/usage', 'Usage'],
    ['#/settings', 'Settings'],
  ]
  aside.innerHTML = '<div class="brand">AgentShow<small>' + escapeHtml(currentUser?.github_login || 'Dashboard') + '</small></div><nav class="nav"></nav>'
  const nav = aside.querySelector('.nav')
  navItems.forEach(function (item) {
    const link = document.createElement('a')
    link.href = item[0]
    link.textContent = item[1]
    if (route.name === item[0].slice(2).split('/')[0] || (item[0] === '#/' && route.name === 'home')) {
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
  if (route.name === 'session') return renderSessionDetailPage(context)
  if (route.name === 'projects') return renderPlaceholderPage('Projects', 'Project aggregates are available. Detailed views can be added next.')
  if (route.name === 'usage') return renderPlaceholderPage('Usage', 'Usage analytics are coming in the next dashboard slice.')
  if (route.name === 'settings') return renderPlaceholderPage('Settings', 'Manage tokens and sync preferences from this page soon.')
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
    '<div class="card">',
    '  <div class="page-header"><div><h1>Sign in</h1><p>Connect GitHub to access your synced agent sessions.</p></div></div>',
    '  <a href="/api/auth/github">Continue with GitHub</a>',
    '</div>',
  ].join('')
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
  if (path === '/login') return { name: 'login', params: [], query: query }
  if (path === '/projects') return { name: 'projects', params: [], query: query }
  if (path === '/usage') return { name: 'usage', params: [], query: query }
  if (path === '/settings') return { name: 'settings', params: [], query: query }
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
${sessionDetailPageJs}
`
