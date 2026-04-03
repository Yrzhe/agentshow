export const searchPageJs = `async function renderSearchPage(context) {
  const page = document.createElement('section')
  const initialQuery = context.route.query.q || ''
  let offset = 0
  let total = 0
  let results = []
  let currentQuery = initialQuery

  page.innerHTML = [
    '<div class="page-header">',
    '  <div><h1>Search</h1><p>Search across all your agent conversations</p></div>',
    '  <div class="meta" id="search-meta"></div>',
    '</div>',
    '<div class="card" style="margin-bottom:1rem;">',
    '  <form id="search-form" class="toolbar" style="margin-bottom:0;">',
    '    <input id="search-input" placeholder="Search content, tools, projects..." value="' + escapeHtml(initialQuery) + '" style="flex:1;min-width:220px;padding:0.8rem 1rem;border-radius:12px;border:1px solid var(--border);background:var(--panel-alt);color:var(--text)">',
    '    <button type="submit">Search</button>',
    '  </form>',
    '</div>',
    '<div id="search-results" style="display:grid;gap:0.9rem;"></div>',
    '<div style="margin-top:1rem;"><button id="search-load-more" style="display:none;">Load More</button></div>',
  ].join('')

  const form = page.querySelector('#search-form')
  const input = page.querySelector('#search-input')
  const meta = page.querySelector('#search-meta')
  const resultsWrap = page.querySelector('#search-results')
  const loadMoreButton = page.querySelector('#search-load-more')

  form.addEventListener('submit', async function (event) {
    event.preventDefault()
    currentQuery = input.value.trim()
    offset = 0
    results = []
    updateHashQuery(currentQuery)
    await loadResults(true)
  })

  loadMoreButton.addEventListener('click', async function () {
    await loadResults(false)
  })

  async function loadResults(reset) {
    if (!currentQuery) {
      renderEmpty()
      return
    }

    const data = await api('/search?q=' + encodeURIComponent(currentQuery) + '&limit=20&offset=' + offset)
    total = Number(data.total || 0)
    results = reset ? data.results || [] : results.concat(data.results || [])
    offset = results.length
    renderResults()
  }

  function renderEmpty() {
    meta.textContent = ''
    resultsWrap.innerHTML = '<div class="card muted">Search across all your agent conversations</div>'
    loadMoreButton.style.display = 'none'
  }

  function renderResults() {
    meta.textContent = total ? (results.length + ' of ' + total + ' results') : '0 results'
    resultsWrap.replaceChildren()

    if (!results.length) {
      const empty = document.createElement('div')
      empty.className = 'card muted'
      empty.textContent = currentQuery ? 'No matches found.' : 'Search across all your agent conversations'
      resultsWrap.appendChild(empty)
      loadMoreButton.style.display = 'none'
      return
    }

    results.forEach(function (result) {
      const card = document.createElement('article')
      card.className = 'card'
      card.style.cursor = 'pointer'
      card.innerHTML = [
        '<div style="display:flex;justify-content:space-between;gap:1rem;align-items:flex-start;margin-bottom:0.5rem;">',
        '  <div><strong>' + escapeHtml(projectName(result.cwd, result.project_slug)) + '</strong> <span class="muted">/' + escapeHtml(String(result.session_id).slice(0, 8)) + '</span></div>',
        '  <div class="meta">' + escapeHtml(formatTimestamp(result.timestamp)) + '</div>',
        '</div>',
        '<div style="margin-bottom:0.6rem;line-height:1.6;">' + highlightSearch(result.content_preview || toolFallback(result), currentQuery) + '</div>',
        '<div class="split"><span>' + (result.source_type === 'note' ? '<span class="badge discovered">note</span>' : statusBadge(result.session_status)) + '</span><span>' + escapeHtml(result.role || result.type || '-') + (result.tool_name ? ' · ' + escapeHtml(result.tool_name) : '') + '</span></div>',
      ].join('')
      card.addEventListener('click', function () {
        location.hash = '#/session/' + encodeURIComponent(result.session_id)
      })
      resultsWrap.appendChild(card)
    })

    loadMoreButton.style.display = results.length < total ? 'inline-flex' : 'none'
  }

  if (initialQuery) {
    await loadResults(true)
  } else {
    renderEmpty()
  }

  return page
}

function updateHashQuery(query) {
  location.hash = query ? '#/search?q=' + encodeURIComponent(query) : '#/search'
}

function toolFallback(result) {
  return result.tool_name ? 'Used ' + result.tool_name : 'Matched in ' + projectName(result.cwd, result.project_slug)
}

function highlightSearch(value, query) {
  const safe = escapeHtml(value || '')
  if (!query) return safe
  const pattern = new RegExp('(' + escapeRegex(query) + ')', 'ig')
  return safe.replace(pattern, '<mark>$1</mark>')
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^$()|[\\]\\\\]/g, '\\\\$&')
}
`
