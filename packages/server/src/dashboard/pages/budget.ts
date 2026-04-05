export function createBudgetPage(): string {
  return String.raw`
function budgetTone(budget) {
  if (budget.is_over_limit) return 'var(--danger)';
  if (budget.is_over_threshold) return 'var(--yellow)';
  return 'var(--green)';
}

function budgetProgress(budget) {
  return Math.max(0, Math.min(100, Number(budget.usage_percent || 0)));
}

function renderBudgetCard(budget) {
  var tone = budgetTone(budget);
  var percent = Number(budget.usage_percent || 0).toFixed(1);
  var threshold = Math.round(Number(budget.alert_threshold || 0) * 100);
  return '<div class="panel">' +
    '<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:10px">' +
      '<div><h3 style="margin-bottom:4px">' + escapeHtml(budget.budget_type === 'daily' ? 'Daily budget' : 'Monthly budget') + '</h3>' +
      '<p class="muted" style="margin:0">Alert at ' + threshold + '% of limit</p></div>' +
      '<button type="button" data-delete-budget="' + escapeHtml(budget.budget_type) + '" style="padding:6px 10px;background:var(--panel-alt);color:var(--text);border:1px solid var(--border);border-radius:0;cursor:pointer">Delete</button>' +
    '</div>' +
    '<div style="display:flex;justify-content:space-between;gap:12px;margin-bottom:8px"><strong>$' + Number(budget.current_usage_usd || 0).toFixed(2) + '</strong><span class="muted">of $' + Number(budget.limit_usd || 0).toFixed(2) + ' · ' + percent + '%</span></div>' +
    '<div style="height:12px;background:var(--panel-alt);border-radius:0;overflow:hidden;border:1px solid var(--border);margin-bottom:10px">' +
      '<div style="height:100%;width:' + budgetProgress(budget) + '%;background:' + tone + ';border-radius:0"></div>' +
    '</div>' +
    '<p style="margin:0;color:' + tone + '">' + (budget.is_over_limit ? 'Budget limit exceeded.' : (budget.is_over_threshold ? 'Budget warning threshold reached.' : 'Budget usage is within range.')) + '</p>' +
  '</div>';
}

function renderBudgetEmpty() {
  return '<div class="panel"><p class="muted" style="margin:0">No budget rules yet. Set a daily or monthly cap below.</p></div>';
}

function renderBudgetForm() {
  return '<form id="budget-form" class="panel" style="display:grid;gap:12px">' +
    '<div><h3 style="margin-bottom:4px">Set budget</h3><p class="muted" style="margin:0">Create or update a daily or monthly USD budget.</p></div>' +
    '<div class="stats-grid">' +
      '<label style="display:grid;gap:6px"><span class="muted">Type</span><select name="budget_type" style="padding:8px 10px;background:var(--bg);border:1px solid var(--border);border-radius:0;color:var(--text)"><option value="daily">Daily</option><option value="monthly">Monthly</option></select></label>' +
      '<label style="display:grid;gap:6px"><span class="muted">Limit (USD)</span><input name="limit_usd" type="number" min="0.01" step="0.01" value="10" style="padding:8px 10px;background:var(--bg);border:1px solid var(--border);border-radius:0;color:var(--text)"></label>' +
      '<label style="display:grid;gap:6px"><span class="muted">Alert threshold</span><input name="alert_threshold" type="number" min="0.1" max="1" step="0.05" value="0.8" style="padding:8px 10px;background:var(--bg);border:1px solid var(--border);border-radius:0;color:var(--text)"></label>' +
    '</div>' +
    '<div style="display:flex;justify-content:space-between;gap:12px;align-items:center"><span id="budget-status" class="muted"></span><button type="submit" style="padding:8px 14px;background:var(--green);color:var(--panel);border:1px solid var(--green);border-radius:0;cursor:pointer">Save budget</button></div>' +
  '</form>';
}

async function loadBudgets() {
  const response = await fetch('/api/budget', { credentials: 'include' });
  if (!response.ok) throw new Error('Failed to load budgets');
  return response.json();
}

async function saveBudget(payload) {
  const response = await fetch('/api/budget', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error('Failed to save budget');
}

async function removeBudget(type) {
  const response = await fetch('/api/budget/' + encodeURIComponent(type), {
    method: 'DELETE',
    credentials: 'include'
  });
  if (!response.ok) throw new Error('Failed to delete budget');
}

export async function renderBudgetPage(root) {
  root.innerHTML = '<section><div class="page-header"><div><h2>Budget</h2><p class="muted">Track daily and monthly spend caps.</p></div></div><div class="panel"><div class="muted">Loading budgets…</div></div></section>';
  try {
    var payload = await loadBudgets();
    var budgets = Array.isArray(payload.budgets) ? payload.budgets : [];
    root.innerHTML = '<section>' +
      '<div class="page-header"><div><h2>Budget</h2><p class="muted">Track daily and monthly spend caps.</p></div></div>' +
      '<div style="display:grid;gap:16px">' + (budgets.length ? budgets.map(renderBudgetCard).join('') : renderBudgetEmpty()) + renderBudgetForm() + '</div>' +
    '</section>';
    var form = root.querySelector('#budget-form');
    var status = root.querySelector('#budget-status');
    if (form && status) {
      form.addEventListener('submit', async function (event) {
        event.preventDefault();
        var data = new FormData(form);
        status.textContent = 'Saving...';
        try {
          await saveBudget({
            budget_type: data.get('budget_type'),
            limit_usd: Number(data.get('limit_usd')),
            alert_threshold: Number(data.get('alert_threshold'))
          });
          await renderBudgetPage(root);
        } catch (error) {
          status.textContent = 'Failed to save budget.';
        }
      });
    }
    root.querySelectorAll('[data-delete-budget]').forEach(function (button) {
      button.addEventListener('click', async function () {
        if (status) status.textContent = 'Deleting...';
        try {
          await removeBudget(button.getAttribute('data-delete-budget'));
          await renderBudgetPage(root);
        } catch (error) {
          if (status) status.textContent = 'Failed to delete budget.';
        }
      });
    });
  } catch (error) {
    root.innerHTML = '<section><div class="page-header"><div><h2>Budget</h2><p class="muted">Track daily and monthly spend caps.</p></div></div><div class="panel"><p class="muted" style="margin:0">Failed to load budget data.</p></div>' + renderBudgetForm() + '</section>';
  }
}
`
}
