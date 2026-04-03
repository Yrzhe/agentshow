export const sessionDetailPageJs = `async function renderSessionDetailPage(context) {
  const sessionId = context.route.params[0]
  const [detail, stats] = await Promise.all([
    api('/sessions/' + encodeURIComponent(sessionId)),
    api('/sessions/' + encodeURIComponent(sessionId) + '/stats'),
  ])

  if (!detail.session) {
    return renderEmptyState('Session not found', 'The requested session is unavailable or you do not have access.')
  }

  const session = detail.session
  const events = Array.isArray(detail.events || detail.recent_events) ? (detail.events || detail.recent_events) : []
  const groupedMessages = groupConversationEvents(events)
  const totalTokens = (stats.total_input_tokens || 0) + (stats.total_output_tokens || 0)
  const inputRatio = totalTokens > 0 ? Math.round(((stats.total_input_tokens || 0) / totalTokens) * 100) : 0
  let visibleCount = Math.min(12, groupedMessages.length)
  const page = document.createElement('section')
  page.innerHTML = [
    '<div class="page-header">',
    '  <div><h1>Session ' + escapeHtml(String(session.session_id).slice(0, 8)) + '</h1><p>' + escapeHtml(projectName(session.cwd, session.project_slug)) + ' <span class=\"muted\" style=\"font-size:12px\">' + escapeHtml(session.cwd || '') + '</span></p></div>',
    '  <button id="back-button">Back</button>',
    '</div>',
    '<div class="card-grid">',
    cardHtml('Session ID', session.session_id),
    cardHtml('Project', projectName(session.cwd, session.project_slug)),
    cardHtml('Status', statusBadge(session.status)),
    cardHtml('Duration', sessionDuration(session.started_at, session.last_seen_at)),
    '</div>',
    '<div class="card" style="margin-bottom:1rem;">',
    '  <div class="card-label">Token Usage</div>',
    '  <div class="card-value">' + escapeHtml(formatNumber(totalTokens)) + ' total</div>',
    '  <div class="progress"><div class="progress-fill" style="width:' + inputRatio + '%"></div></div>',
    '  <div class="split"><span>Input ' + escapeHtml(formatNumber(stats.total_input_tokens || 0)) + '</span><span>Output ' + escapeHtml(formatNumber(stats.total_output_tokens || 0)) + '</span></div>',
    '</div>',
    '<div class="card">',
    '  <div class="page-header" style="margin-bottom:1rem;">',
    '    <div><h1 style="font-size:1.1rem;margin:0;">Conversation</h1><p>Grouped adjacent turns for a cleaner timeline view.</p></div>',
    '    <button id="load-more-button" style="display:none;">Load Earlier</button>',
    '  </div>',
    '  <div id="timeline" style="display:grid;gap:1rem;"></div>',
    '</div>',
  ].join('')

  page.querySelector('#back-button').addEventListener('click', function () {
    history.back()
  })

  const timeline = page.querySelector('#timeline')
  const loadMoreButton = page.querySelector('#load-more-button')

  function renderTimeline() {
    timeline.replaceChildren()

    if (!groupedMessages.length) {
      const empty = document.createElement('div')
      empty.className = 'muted'
      empty.textContent = 'No recent conversation events available.'
      timeline.appendChild(empty)
      loadMoreButton.style.display = 'none'
      return
    }

    const startIndex = Math.max(0, groupedMessages.length - visibleCount)
    const visibleMessages = groupedMessages.slice(startIndex)

    visibleMessages.forEach(function (message) {
      timeline.appendChild(renderTimelineMessage(message))
    })

    loadMoreButton.style.display = startIndex > 0 ? 'inline-flex' : 'none'
  }

  loadMoreButton.addEventListener('click', function () {
    visibleCount = Math.min(groupedMessages.length, visibleCount + 12)
    renderTimeline()
  })

  renderTimeline()

  return page
}

function cardHtml(label, value) {
  return '<div class="card"><div class="card-label">' + label + '</div><div class="card-value">' + value + '</div></div>'
}

function groupConversationEvents(events) {
  const groups = []

  events.forEach(function (event) {
    const role = normalizeRole(event)
    if (!role) return

    const previous = groups[groups.length - 1]
    if (!previous || previous.role !== role) {
      groups.push(createMessageGroup(event, role))
      return
    }

    if (event.content_preview) previous.contents.push(event.content_preview)
    if (event.tool_name) {
      event.tool_name.split(',').forEach(function (name) {
        const trimmed = name.trim()
        if (trimmed && previous.tools.indexOf(trimmed) === -1) previous.tools.push(trimmed)
      })
    }
    previous.tokens += (event.input_tokens || 0) + (event.output_tokens || 0)
    previous.inputTokens += event.input_tokens || 0
    previous.outputTokens += event.output_tokens || 0
    previous.model = previous.model || event.model || null
    previous.timestamp = event.timestamp || previous.timestamp
  })

  return groups
}

function createMessageGroup(event, role) {
  const tools = []
  if (event.tool_name) {
    event.tool_name.split(',').forEach(function (name) {
      const trimmed = name.trim()
      if (trimmed) tools.push(trimmed)
    })
  }
  return {
    role: role,
    timestamp: event.timestamp || '',
    contents: event.content_preview ? [event.content_preview] : [],
    tools: tools,
    tokens: (event.input_tokens || 0) + (event.output_tokens || 0),
    inputTokens: event.input_tokens || 0,
    outputTokens: event.output_tokens || 0,
    model: event.model || null,
  }
}

function normalizeRole(event) {
  if (event.role === 'user' || event.role === 'assistant') return event.role
  if (event.role === 'system' || event.type === 'system') return null
  return null
}

function renderTimelineMessage(message) {
  const wrapper = document.createElement('article')
  const align = message.role === 'assistant' ? 'margin-left:auto;max-width:88%;' : 'max-width:88%;'
  const tone = message.role === 'assistant'
    ? 'background:rgba(88,166,255,0.08);border:1px solid rgba(88,166,255,0.2);'
    : 'background:rgba(255,255,255,0.03);border:1px solid var(--border);'
  const toolBadges = message.tools.map(function (tool) {
    return '<span class="badge discovered" style="margin-right:0.4rem;margin-top:0.35rem;">' + escapeHtml(tool) + '</span>'
  }).join('')
  const content = message.contents.length
    ? message.contents.join('\\n\\n')
    : (message.tools.length ? 'Used ' + message.tools.join(', ') : 'No preview available.')

  wrapper.innerHTML = [
    '<div class="card" style="' + align + tone + '">',
    '  <div style="display:flex;justify-content:space-between;gap:1rem;align-items:flex-start;margin-bottom:0.75rem;">',
    '    <div><div class="card-label">' + escapeHtml(message.role === 'assistant' ? 'Agent Reply' : 'User Message') + '</div></div>',
    '    <div class="meta">' + escapeHtml(formatTimestamp(message.timestamp)) + '</div>',
    '  </div>',
    '  <div style="white-space:pre-wrap;line-height:1.6;">' + escapeHtml(truncate(content, 1200)) + '</div>',
    (toolBadges ? '<div style="margin-top:0.75rem;">' + toolBadges + '</div>' : ''),
    '  <div class="split" style="margin-top:0.85rem;">',
    '    <span>' + escapeHtml(formatNumber(message.tokens)) + ' tokens</span>',
    '    <span>' + escapeHtml(message.model || (message.tools.length ? 'tool-use' : '-')) + '</span>',
    '  </div>',
    '</div>',
  ].join('')
  return wrapper
}
`
