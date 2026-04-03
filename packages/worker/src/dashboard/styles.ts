export const stylesCss = `:root {
  --bg: #0d1117;
  --panel: #161b22;
  --panel-alt: #1c2128;
  --border: #30363d;
  --text: #e6edf3;
  --muted: #8b949e;
  --green: #3fb950;
  --yellow: #d29922;
  --gray: #8b949e;
  --blue: #58a6ff;
  --danger: #f85149;
  --shadow: 0 20px 40px rgba(0, 0, 0, 0.24);
  --radius: 16px;
  --font: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; background: var(--bg); color: var(--text); font-family: var(--font); }
a { color: inherit; }
button, input { font: inherit; }
button {
  cursor: pointer;
  border: 1px solid var(--border);
  background: var(--panel-alt);
  color: var(--text);
  border-radius: 999px;
  padding: 0.55rem 1rem;
}
button:hover { border-color: var(--blue); }

.shell {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  min-height: 100vh;
}
.sidebar {
  border-right: 1px solid var(--border);
  padding: 1.5rem 1rem;
  background: linear-gradient(180deg, rgba(88,166,255,0.08), transparent 40%), var(--bg);
}
.brand {
  font-size: 1.2rem;
  font-weight: 700;
  margin-bottom: 1.5rem;
}
.brand small {
  display: block;
  margin-top: 0.35rem;
  color: var(--muted);
  font-weight: 500;
}
.nav {
  display: grid;
  gap: 0.5rem;
}
.nav a {
  text-decoration: none;
  padding: 0.8rem 0.9rem;
  border-radius: 12px;
  color: var(--muted);
}
.nav a.active,
.nav a:hover {
  background: var(--panel);
  color: var(--text);
}
.content {
  padding: 2rem;
}
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.5rem;
}
.page-header h1 { margin: 0; font-size: 1.75rem; }
.page-header p { margin: 0.35rem 0 0; color: var(--muted); }
.meta { color: var(--muted); font-size: 0.92rem; }

.card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 1rem 1.1rem;
}
.card-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1rem;
  margin-bottom: 1.25rem;
}
.card-label {
  color: var(--muted);
  font-size: 0.85rem;
  margin-bottom: 0.4rem;
}
.card-value {
  font-size: 1.15rem;
  font-weight: 700;
  word-break: break-word;
}

.toolbar {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 1rem;
}
.toolbar button.active {
  background: rgba(88, 166, 255, 0.14);
  border-color: rgba(88, 166, 255, 0.4);
}

.table-wrap {
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--panel);
}
table {
  width: 100%;
  border-collapse: collapse;
  min-width: 840px;
}
th, td {
  padding: 0.9rem 1rem;
  text-align: left;
  border-bottom: 1px solid rgba(48, 54, 61, 0.75);
}
th {
  color: var(--muted);
  font-size: 0.82rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
tbody tr { cursor: pointer; }
tbody tr:hover { background: rgba(255, 255, 255, 0.03); }
tbody tr:last-child td { border-bottom: 0; }

.badge {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  border-radius: 999px;
  padding: 0.28rem 0.65rem;
  font-size: 0.8rem;
  font-weight: 700;
  text-transform: capitalize;
}
.badge.active { color: var(--green); background: rgba(63, 185, 80, 0.12); }
.badge.discovered { color: var(--yellow); background: rgba(210, 153, 34, 0.14); }
.badge.ended { color: var(--gray); background: rgba(139, 148, 158, 0.16); }

.progress {
  height: 10px;
  border-radius: 999px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.05);
  margin: 0.6rem 0 0.35rem;
}
.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--blue), #7ee787);
}
.split {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  color: var(--muted);
  font-size: 0.9rem;
}

.empty, .login {
  max-width: 720px;
  padding: 2rem;
}
.login .card { max-width: 480px; }
.login a {
  display: inline-flex;
  text-decoration: none;
  margin-top: 1rem;
  padding: 0.8rem 1rem;
  border-radius: 12px;
  background: var(--blue);
  color: #081018;
  font-weight: 700;
}
.muted { color: var(--muted); }

@media (max-width: 920px) {
  .shell { grid-template-columns: 1fr; }
  .sidebar {
    border-right: 0;
    border-bottom: 1px solid var(--border);
  }
  .card-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .content { padding: 1rem; }
}

@media (max-width: 640px) {
  .card-grid { grid-template-columns: 1fr; }
  .page-header { flex-direction: column; align-items: flex-start; }
}
`
