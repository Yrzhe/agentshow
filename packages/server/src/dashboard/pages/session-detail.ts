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
    '<div style="display:flex;justify-content:flex-end;margin-bottom:1rem;"><a href="#/replay/' + encodeURIComponent(session.session_id) + '">Replay Session</a></div>',
    (session.task ? '<div class="card" style="margin-bottom:1rem;"><div class="card-label">Task</div><div style="line-height:1.6;white-space:pre-wrap;">' + escapeHtml(session.task) + '</div></div>' : ''),
    (session.files ? '<div class="card" style="margin-bottom:1rem;"><div class="card-label">Files</div><ul id="files-list" style="margin:0;padding-left:1.2rem;line-height:1.8;">' + (function () { try { return JSON.parse(session.files).map(function (f) { return '<li style="font-family:monospace;font-size:0.85rem;">' + escapeHtml(f) + '</li>' }).join('') } catch(e) { return '<li>' + escapeHtml(session.files) + '</li>' } })() + '</ul></div>' : ''),
    '<div id="notes-section"></div>',
    '<div class="card" style="margin-bottom:1rem;">',
    '  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:0.5rem;">',
    '    <div class="card-label">Summary</div>',
    session.summary
      ? ''
      : '    <button id="gen-summary-btn" style="padding:4px 12px;background:#21262d;color:#e6edf3;border:1px solid #30363d;border-radius:6px;cursor:pointer;font-size:12px">Generate Summary</button>',
    '  </div>',
    '  <div id="summary-content" style="line-height:1.6;">' + (session.summary ? escapeHtml(session.summary) : '<span class=\"muted\">No summary</span>') + '</div>',
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

  var genBtn = page.querySelector('#gen-summary-btn')
  if (genBtn) {
    genBtn.addEventListener('click', async function () {
      genBtn.textContent = 'Generating...'
      genBtn.disabled = true
      try {
        var res = await fetch('/api/sessions/' + encodeURIComponent(session.session_id) + '/summary', {
          method: 'POST', credentials: 'include'
        })
        var data = await res.json()
        if (res.ok && data.summary) {
          page.querySelector('#summary-content').textContent = data.summary
          genBtn.style.display = 'none'
        } else {
          genBtn.textContent = data.error || 'Failed'
          genBtn.disabled = false
        }
      } catch (err) {
        genBtn.textContent = 'Error'
        genBtn.disabled = false
      }
    })
  }

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

  try {
    var notesData = await api('/notes?session_id=' + encodeURIComponent(session.session_id))
    var notesList = Array.isArray(notesData.notes) ? notesData.notes : []
    if (notesList.length > 0) {
      var notesSection = page.querySelector('#notes-section')
      var notesHtml = '<div class="card" style="margin-bottom:1rem;">' +
        '<div class="card-label" style="margin-bottom:0.75rem;">Notes (' + notesList.length + ')</div>' +
        '<div style="display:grid;gap:0.75rem;">'
      notesList.forEach(function (note) {
        notesHtml += '<div style="padding:0.75rem;background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:8px;">' +
          '<div style="font-weight:600;margin-bottom:0.4rem;font-size:0.9rem;">' + escapeHtml(note.key) + '</div>' +
          '<div style="white-space:pre-wrap;line-height:1.6;font-size:0.85rem;">' + escapeHtml(note.content) + '</div>' +
          '<div class="meta" style="margin-top:0.4rem;">' + escapeHtml(formatTimestamp(note.updated_at)) + '</div>' +
          '</div>'
      })
      notesHtml += '</div></div>'
      notesSection.innerHTML = notesHtml
    }
  } catch (e) {
    // notes fetch failed silently
  }

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
