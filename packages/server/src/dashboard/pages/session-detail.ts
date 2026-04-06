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
      : '    <button id="gen-summary-btn" style="padding:4px 12px;background:var(--panel-alt);color:var(--text);border:1px dashed var(--border);cursor:pointer;font-size:12px">Generate Summary</button>',
    '  </div>',
    '  <div id="summary-content" style="line-height:1.6;">' + (session.summary ? escapeHtml(session.summary) : '<span class=\"muted\">No summary</span>') + '</div>',
    '</div>',
    '<div class="card" style="margin-bottom:1rem;">',
    '  <div class="card-label">Token Usage</div>',
    '  <div class="card-value">' + escapeHtml(formatNumber(totalTokens)) + ' total</div>',
    '  <div class="progress"><div class="progress-fill" style="width:' + inputRatio + '%"></div></div>',
    '  <div class="split"><span>Input ' + escapeHtml(formatNumber(stats.total_input_tokens || 0)) + '</span><span>Output ' + escapeHtml(formatNumber(stats.total_output_tokens || 0)) + '</span></div>',
    '</div>',
    '<div class="card" style="display:flex;flex-direction:column;">',
    '  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem;">',
    '    <div><div class="card-label">Conversation</div></div>',
    '    <button id="load-more-button" style="display:none;">Load Earlier</button>',
    '  </div>',
    '  <div id="timeline-wrap" style="height:520px;overflow-y:auto;border:1px dashed var(--border);padding:1rem;">',
    '    <div id="timeline" style="display:grid;gap:0.75rem;"></div>',
    '  </div>',
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

  var timelineWrap = page.querySelector('#timeline-wrap')

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
    // scroll to bottom
    timelineWrap.scrollTop = timelineWrap.scrollHeight
  }

  loadMoreButton.addEventListener('click', function () {
    var prevHeight = timelineWrap.scrollHeight
    visibleCount = Math.min(groupedMessages.length, visibleCount + 20)
    renderTimeline()
    // keep scroll position at where older messages were loaded
    timelineWrap.scrollTop = timelineWrap.scrollHeight - prevHeight
  })

  renderTimeline()

  // Live updates via SSE
  if (session.status === 'active') {
    var lastEventCount = events.length
    context.setCleanup(connectSSE({ watch: 'session', id: sessionId }, function (data) {
      var freshEvents = Array.isArray(data.events || data.recent_events) ? (data.events || data.recent_events) : []
      if (freshEvents.length > lastEventCount) {
        lastEventCount = freshEvents.length
        var wasAtBottom = timelineWrap.scrollTop + timelineWrap.clientHeight >= timelineWrap.scrollHeight - 20
        groupedMessages.length = 0
        groupConversationEvents(freshEvents).forEach(function (g) { groupedMessages.push(g) })
        visibleCount = Math.min(20, groupedMessages.length)
        renderTimeline()
        if (data.stats) {
          var freshTotal = (data.stats.total_input_tokens || 0) + (data.stats.total_output_tokens || 0)
          var tokenCard = page.querySelector('.card-value')
          if (tokenCard) tokenCard.textContent = formatNumber(freshTotal) + ' total'
        }
      }
    }))
  }

  try {
    var notesData = await api('/notes?session_id=' + encodeURIComponent(session.session_id))
    var notesList = Array.isArray(notesData.notes) ? notesData.notes : []
    if (notesList.length > 0) {
      var notesSection = page.querySelector('#notes-section')
      var notesHtml = '<div class="card" style="margin-bottom:1rem;">' +
        '<div class="card-label" style="margin-bottom:0.75rem;">Notes (' + notesList.length + ')</div>' +
        '<div style="display:grid;gap:0.75rem;">'
      notesList.forEach(function (note) {
        notesHtml += '<div style="padding:0.75rem;background:var(--panel-alt);border:1px dashed var(--border);">' +
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
    ? 'border:1px dashed var(--border);border-left:3px solid var(--yellow);'
    : 'border:1px dashed var(--border);border-left:3px solid var(--border);'
  const toolBadges = message.tools.map(function (tool) {
    return '<span class="badge discovered" style="margin-right:0.4rem;margin-top:0.35rem;">' + escapeHtml(tool) + '</span>'
  }).join('')
  const content = message.contents.length
    ? message.contents.join('\\n\\n')
    : (message.tools.length ? 'Used ' + message.tools.join(', ') : 'No preview available.')

  var isLong = content.length > 600
  var preview = isLong ? truncate(content, 600) : content
  var contentId = 'msg-' + Math.random().toString(36).slice(2, 8)

  wrapper.innerHTML = [
    '<div style="' + tone + 'padding:0.65rem 0.85rem;">',
    '  <div style="display:flex;justify-content:space-between;gap:0.5rem;align-items:center;margin-bottom:0.5rem;">',
    '    <div class="card-label" style="margin:0;">' + escapeHtml(message.role === 'assistant' ? 'AGENT' : 'USER') + '</div>',
    '    <div style="display:flex;gap:0.5rem;align-items:center;">',
    '      <span class="meta">' + escapeHtml(formatNumber(message.tokens)) + ' tok</span>',
    '      <span class="meta">' + escapeHtml(formatTimestamp(message.timestamp)) + '</span>',
    '    </div>',
    '  </div>',
    '  <div id="' + contentId + '" class="md-content" style="line-height:1.7;font-size:12px;">' + renderMd(preview) + '</div>',
    (isLong ? '<button type="button" data-expand="' + contentId + '" style="margin-top:0.4rem;font-size:11px;padding:0.2rem 0.6rem;border:1px dashed var(--border);background:var(--panel-alt);cursor:pointer;">Show full message</button>' : ''),
    (toolBadges ? '<div style="margin-top:0.5rem;">' + toolBadges + '</div>' : ''),
    '</div>',
  ].join('')

  if (isLong) {
    var expandBtn = wrapper.querySelector('[data-expand]')
    if (expandBtn) {
      expandBtn.addEventListener('click', function () {
        var target = document.getElementById(contentId)
        if (!target) return
        var expanded = expandBtn.getAttribute('data-expanded') === '1'
        if (expanded) {
          target.innerHTML = renderMd(preview)
          expandBtn.textContent = 'Show full message'
          expandBtn.setAttribute('data-expanded', '0')
        } else {
          target.innerHTML = renderMd(content)
          expandBtn.textContent = 'Collapse'
          expandBtn.setAttribute('data-expanded', '1')
        }
      })
    }
  }

  return wrapper
}

function renderMd(text) {
  var s = escapeHtml(text)
  // code blocks
  s = s.replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, function(_, code) {
    return '<pre style="background:var(--panel-alt);border:1px dashed var(--border);padding:0.6rem 0.8rem;overflow-x:auto;font-size:12px;margin:0.5rem 0;"><code>' + code.trim() + '</code></pre>'
  })
  // inline code
  s = s.replace(/\`([^\`]+)\`/g, '<code style="background:var(--panel-alt);padding:0.1rem 0.3rem;font-size:12px;">$1</code>')
  // bold
  s = s.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>')
  // headers
  s = s.replace(/^### (.+)$/gm, '<div style="font-weight:700;font-size:14px;margin:0.6rem 0 0.3rem;">$1</div>')
  s = s.replace(/^## (.+)$/gm, '<div style="font-weight:700;font-size:15px;margin:0.6rem 0 0.3rem;">$1</div>')
  s = s.replace(/^# (.+)$/gm, '<div style="font-weight:700;font-size:16px;margin:0.6rem 0 0.3rem;">$1</div>')
  // bullet lists
  s = s.replace(/^- (.+)$/gm, '<div style="padding-left:1rem;">• $1</div>')
  // line breaks
  s = s.replace(/\\n/g, '<br>')
  return s
}
`
