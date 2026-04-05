export function createReplayPage(): string {
  return String.raw`
function formatReplayTime(ms) {
  var totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000))
  var minutes = Math.floor(totalSeconds / 60)
  var seconds = totalSeconds % 60
  return String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0')
}

function replayEventKind(event) {
  if (String(event.tool_name || '').trim()) return 'tool'
  if (event.role === 'user') return 'user'
  if (event.role === 'assistant') return 'assistant'
  return 'system'
}

function replayEventLabel(event) {
  if (replayEventKind(event) === 'tool') return 'Tool · ' + String(event.tool_name || '').trim()
  if (event.role === 'user') return 'User'
  if (event.role === 'assistant') return 'Assistant'
  return event.type || 'Event'
}

function replayEventContent(event) {
  if (event.content_preview) return event.content_preview
  if (event.tool_name) return 'Called ' + event.tool_name
  return 'No preview available.'
}

function replayRenderMd(text) {
  var s = escapeHtml(text)
  s = s.replace(/\`\`\`([\s\S]*?)\`\`\`/g, function(_, code) {
    return '<pre style="background:var(--panel-alt);border:1px dashed var(--border);padding:0.6rem 0.8rem;overflow-x:auto;font-size:12px;margin:0.5rem 0;"><code>' + code.trim() + '</code></pre>'
  })
  s = s.replace(/\`([^\`]+)\`/g, '<code style="background:var(--panel-alt);padding:0.1rem 0.3rem;font-size:12px;">$1</code>')
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/^### (.+)$/gm, '<div style="font-weight:700;font-size:14px;margin:0.6rem 0 0.3rem;">$1</div>')
  s = s.replace(/^## (.+)$/gm, '<div style="font-weight:700;font-size:15px;margin:0.6rem 0 0.3rem;">$1</div>')
  s = s.replace(/^# (.+)$/gm, '<div style="font-weight:700;font-size:16px;margin:0.6rem 0 0.3rem;">$1</div>')
  s = s.replace(/^- (.+)$/gm, '<div style="padding-left:1rem;">• $1</div>')
  s = s.replace(/\n/g, '<br>')
  return s
}

function renderReplayEvent(event, index) {
  var kind = replayEventKind(event)
  var totalTokens = Number(event.input_tokens || 0) + Number(event.output_tokens || 0)
  var meta = []
  if (totalTokens > 0) meta.push(formatNumber(totalTokens) + ' tokens')
  if (event.model) meta.push(event.model)
  return '<article class="replay-event replay-event--' + kind + '" data-replay-index="' + index + '">' +
    '<div class="replay-event__time">' + escapeHtml(formatReplayTime(event.elapsed_ms)) + '</div>' +
    '<div class="replay-event__bubble">' +
      '<div style="display:flex;justify-content:space-between;gap:1rem;align-items:flex-start;margin-bottom:0.45rem">' +
        '<strong>' + escapeHtml(replayEventLabel(event)) + '</strong>' +
        '<span class="muted" style="font-size:12px">' + escapeHtml(formatTimestamp(event.timestamp)) + '</span>' +
      '</div>' +
      '<div class="md-content" style="line-height:1.7;font-size:12px;">' + replayRenderMd(replayEventContent(event)) + '</div>' +
      '<div class="muted" style="margin-top:0.5rem;font-size:12px">' + escapeHtml(meta.join(' · ') || 'No token metadata') + '</div>' +
    '</div>' +
  '</article>'
}

export async function renderReplayPage(root, sessionId) {
  root.innerHTML = '<div class="panel"><div class="muted">Loading replay…</div></div>'
  try {
    var payload = await api('/replay/' + encodeURIComponent(sessionId))
    var timeline = Array.isArray(payload.timeline) ? payload.timeline : []
    var session = payload.session || {}
    var stats = payload.stats || {}
    var durationMs = Number(stats.duration_ms || 0)
    var BASE_INTERVAL_MS = 800
    var state = { isPlaying: false, playbackSpeed: 1, currentEventIndex: 0, playbackTimer: null, renderedCount: 0 }

    root.innerHTML = '<section>' +
      '<div class="page-header"><div><h2>Session Replay</h2><p class="muted">' + escapeHtml(projectName(null, session.project_slug || 'unknown')) + ' · ' + escapeHtml(session.session_id || sessionId) + '</p></div><a href="#/session/' + encodeURIComponent(sessionId) + '">Back to session</a></div>' +
      '<div class="card-grid">' +
        '<div class="panel"><span class="muted">Status</span><h3>' + statusBadge(session.status || 'ended') + '</h3></div>' +
        '<div class="panel"><span class="muted">Duration</span><h3>' + escapeHtml(formatReplayTime(durationMs)) + '</h3></div>' +
        '<div class="panel"><span class="muted">Total tokens</span><h3>' + formatNumber(Number(stats.total_input_tokens || 0) + Number(stats.total_output_tokens || 0)) + '</h3></div>' +
        '<div class="panel"><span class="muted">Tool calls</span><h3>' + formatNumber(stats.tool_calls || 0) + '</h3></div>' +
      '</div>' +
      (session.task ? '<div class="panel" style="margin-bottom:1rem"><div class="card-label">Task</div><div style="white-space:pre-wrap;line-height:1.6">' + escapeHtml(session.task) + '</div></div>' : '') +
      '<div class="panel" style="padding-bottom:0">' +
        '<div class="page-header" style="margin-bottom:0.5rem"><div><h3 style="margin:0">Timeline</h3><p class="muted">Replay the full session event stream in chronological order.</p></div><div class="muted">' + escapeHtml(String((stats.unique_tools || []).join(', ') || 'No tools')) + '</div></div>' +
        '<div id="replay-timeline" class="replay-timeline"></div>' +
      '</div>' +
      '<div class="replay-controls">' +
        '<button id="replay-toggle">Play</button>' +
        '<div id="replay-counter" class="muted">0 / ' + formatNumber(timeline.length) + '</div>' +
        '<div id="replay-current-time" class="replay-event__time">' + escapeHtml(formatReplayTime(0)) + ' / ' + escapeHtml(formatReplayTime(durationMs)) + '</div>' +
        '<div id="replay-progress" class="replay-progress"><div id="replay-progress-fill" class="replay-progress__fill" style="width:0%"></div></div>' +
        '<div class="replay-speed">' + [1, 2, 5, 10].map(function (speed) {
          return '<button type="button" data-replay-speed="' + speed + '"' + (speed === 1 ? ' class="active"' : '') + '>' + speed + 'x</button>'
        }).join('') + '</div>' +
      '</div>' +
    '</section>'

    var timelineEl = root.querySelector('#replay-timeline')
    var progressEl = root.querySelector('#replay-progress')
    var progressFillEl = root.querySelector('#replay-progress-fill')
    var toggleEl = root.querySelector('#replay-toggle')
    var counterEl = root.querySelector('#replay-counter')
    var currentTimeEl = root.querySelector('#replay-current-time')

    function clearTimer() {
      if (state.playbackTimer) {
        clearTimeout(state.playbackTimer)
        state.playbackTimer = null
      }
    }

    function updateProgress(index) {
      var current = index > 0 ? timeline[Math.min(index - 1, timeline.length - 1)] : null
      var elapsed = current ? Number(current.elapsed_ms || 0) : 0
      var width = timeline.length > 0 ? Math.min(100, Math.round((index / timeline.length) * 1000) / 10) : 0
      progressFillEl.style.width = width + '%'
      counterEl.textContent = formatNumber(index) + ' / ' + formatNumber(timeline.length)
      currentTimeEl.textContent = formatReplayTime(elapsed) + ' / ' + formatReplayTime(durationMs)
    }

    function ensureRendered(index) {
      while (state.renderedCount < index && state.renderedCount < timeline.length) {
        timelineEl.insertAdjacentHTML('beforeend', renderReplayEvent(timeline[state.renderedCount], state.renderedCount))
        state.renderedCount += 1
      }
    }

    function scrollToCurrent(index) {
      var node = timelineEl.querySelector('[data-replay-index="' + Math.max(0, index - 1) + '"]')
      if (node) node.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }

    function pauseReplay() {
      state.isPlaying = false
      clearTimer()
      toggleEl.textContent = 'Play'
    }

    function playNext() {
      if (!state.isPlaying) return
      if (state.currentEventIndex >= timeline.length) {
        pauseReplay()
        return
      }
      ensureRendered(state.currentEventIndex + 1)
      state.currentEventIndex += 1
      updateProgress(state.currentEventIndex)
      scrollToCurrent(state.currentEventIndex)
      if (state.currentEventIndex >= timeline.length) {
        pauseReplay()
        return
      }
      var delay = Math.max(BASE_INTERVAL_MS / state.playbackSpeed, 50)
      state.playbackTimer = setTimeout(playNext, delay)
    }

    function playReplay() {
      if (state.currentEventIndex >= timeline.length) {
        state.currentEventIndex = 0
        state.renderedCount = 0
        timelineEl.innerHTML = ''
        updateProgress(0)
      }
      if (state.isPlaying) return
      state.isPlaying = true
      toggleEl.textContent = 'Pause'
      playNext()
    }

    function seekToIndex(index) {
      pauseReplay()
      state.currentEventIndex = Math.max(0, Math.min(index, timeline.length))
      state.renderedCount = state.currentEventIndex
      timelineEl.innerHTML = timeline.slice(0, state.currentEventIndex).map(renderReplayEvent).join('')
      updateProgress(state.currentEventIndex)
      scrollToCurrent(state.currentEventIndex)
    }

    toggleEl.addEventListener('click', function () {
      if (state.isPlaying) pauseReplay()
      else playReplay()
    })

    Array.from(root.querySelectorAll('[data-replay-speed]')).forEach(function (button) {
      button.addEventListener('click', function () {
        state.playbackSpeed = Number(button.getAttribute('data-replay-speed') || 1)
        Array.from(root.querySelectorAll('[data-replay-speed]')).forEach(function (item) { item.classList.remove('active') })
        button.classList.add('active')
        if (state.isPlaying) {
          clearTimer()
          playNext()
        }
      })
    })

    progressEl.addEventListener('click', function (event) {
      var rect = progressEl.getBoundingClientRect()
      var ratio = rect.width > 0 ? Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) : 0
      var targetIndex = Math.round(ratio * timeline.length)
      seekToIndex(targetIndex)
    })

    updateProgress(0)
    if (!timeline.length) {
      timelineEl.innerHTML = '<div class="muted">No replay events available for this session.</div>'
      toggleEl.disabled = true
    }
  } catch (error) {
    root.innerHTML = '<section><div class="page-header"><div><h2>Session Replay</h2><p class="muted">Replay the full event stream for a session.</p></div></div><div class="panel"><p class="muted" style="margin:0">' + escapeHtml(error.message || 'Failed to load replay') + '</p></div></section>'
  }
}
`
}
