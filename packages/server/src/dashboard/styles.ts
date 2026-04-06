export const stylesCss = `@import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap');

:root {
  --bg: #FDFBF5;
  --panel: #FFFFFF;
  --panel-alt: #F5F2EC;
  --border: #C8C0B0;
  --border-style: 1px dashed #C8C0B0;
  --text: #1A1A1A;
  --muted: #8B8178;
  --green: #2D7A3A;
  --yellow: #D4A017;
  --blue: #2563EB;
  --danger: #C53030;
  --gray: #8B8178;
  --shadow: none;
  --radius: 0;
  --font: "Space Mono", monospace;
}

* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; background: var(--bg); color: var(--text); font-family: var(--font); font-size: 13px; overflow-x: hidden; max-width: 100vw; }
a { color: inherit; }
button, input, select, textarea { font: inherit; }
button {
  cursor: pointer;
  border: var(--border-style);
  background: var(--panel);
  color: var(--text);
  border-radius: 0;
  padding: 0.5rem 1rem;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
button:hover { border-color: var(--text); }
input, select, textarea {
  border: var(--border-style);
  background: var(--panel);
  color: var(--text);
  padding: 0.5rem 0.75rem;
  border-radius: 0;
}
input:focus, select:focus, textarea:focus {
  outline: 2px solid var(--yellow);
  outline-offset: -2px;
}

.shell {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  height: 100vh;
  overflow: hidden;
}
.sidebar {
  border-right: var(--border-style);
  padding: 1.5rem 1rem;
  background: var(--panel);
  overflow-y: auto;
  height: 100vh;
  position: sticky;
  top: 0;
}
.content {
  overflow-y: auto;
  height: 100vh;
  padding: 2rem;
}
.brand {
  font-size: 14px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 0.25rem;
}
.brand small {
  display: block;
  margin-top: 0.25rem;
  color: var(--muted);
  font-weight: 400;
  font-size: 11px;
  text-transform: none;
  letter-spacing: 0;
}
.nav-group {
  margin-top: 1.25rem;
}
.nav-group-label {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--muted);
  margin-bottom: 0.35rem;
  padding: 0 0.5rem;
}
.nav {
  display: grid;
  gap: 0;
}
.nav a {
  text-decoration: none;
  padding: 0.45rem 0.5rem;
  color: var(--muted);
  font-size: 12px;
  border-left: 2px solid transparent;
}
.nav a.active {
  color: var(--text);
  border-left-color: var(--yellow);
  background: var(--panel-alt);
  font-weight: 700;
}
.nav a:hover {
  color: var(--text);
  background: var(--panel-alt);
}
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.5rem;
}
.page-header h1 {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.page-header p { margin: 0.25rem 0 0; color: var(--muted); font-size: 12px; }
.meta { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }

.card {
  background: var(--panel);
  border: var(--border-style);
  padding: 1rem;
  overflow: hidden;
  min-width: 0;
}
.panel {
  background: var(--panel);
  border: var(--border-style);
  padding: 1rem;
}
.card-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1rem;
  margin-bottom: 1.25rem;
}
.card-label {
  color: var(--muted);
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 0.35rem;
}
.card-value {
  font-size: 18px;
  font-weight: 700;
  word-break: break-word;
}

.toolbar {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 1rem;
}
.toolbar button.active {
  background: var(--yellow);
  color: #FFFFFF;
  border-color: var(--yellow);
}
.split-layout {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}
.stats-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem;
}
.stats-grid strong,
.chart-row__label strong {
  display: block;
  margin-top: 0.35rem;
}
.chart-list {
  display: grid;
  gap: 0.85rem;
}
.chart-row {
  display: grid;
  gap: 0.35rem;
}
.chart-row__label {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  font-size: 12px;
}
.chart-row__label span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chart-bar {
  height: 8px;
  overflow: hidden;
  background: var(--panel-alt);
  border: 1px solid var(--border);
}
.chart-bar__fill {
  height: 100%;
  background: var(--yellow);
}

.table-wrap {
  overflow: auto;
  border: var(--border-style);
  background: var(--panel);
}
table {
  width: 100%;
  border-collapse: collapse;
  min-width: 840px;
}
th, td {
  padding: 0.7rem 0.9rem;
  text-align: left;
  border-bottom: var(--border-style);
}
th {
  color: var(--muted);
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
tbody tr { cursor: pointer; }
tbody tr:hover { background: var(--panel-alt); }
tbody tr:last-child td { border-bottom: 0; }

.badge {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  border: 1px solid;
  padding: 0.2rem 0.5rem;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.badge.active { color: var(--green); border-color: var(--green); background: rgba(45, 122, 58, 0.08); }
.badge.discovered { color: var(--yellow); border-color: var(--yellow); background: rgba(212, 160, 23, 0.08); }
.badge.ended { color: var(--gray); border-color: var(--border); background: var(--panel-alt); }

.progress {
  height: 8px;
  overflow: hidden;
  background: var(--panel-alt);
  border: 1px solid var(--border);
  margin: 0.6rem 0 0.35rem;
}
.progress-fill {
  height: 100%;
  background: var(--yellow);
}
.split {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  color: var(--muted);
  font-size: 11px;
}

.empty, .login {
  max-width: 720px;
  padding: 2rem;
}
.login .card { max-width: 400px; }
.login a {
  display: inline-flex;
  text-decoration: none;
  margin-top: 1rem;
  padding: 0.7rem 1rem;
  background: var(--text);
  color: var(--bg);
  font-weight: 700;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.muted { color: var(--muted); }
.project-card {
  display: grid;
  gap: 0.75rem;
  text-decoration: none;
  overflow: hidden;
  min-width: 0;
}
.project-card__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}
.project-card__slug {
  font-weight: 700;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.project-card__cwd {
  margin: 0;
  min-height: 2.4em;
  font-size: 11px;
  color: var(--muted);
  overflow-x: auto;
  overflow-y: hidden;
  white-space: nowrap;
  max-width: 100%;
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}
.project-card__cwd::-webkit-scrollbar {
  height: 4px;
}
.project-card__cwd::-webkit-scrollbar-track {
  background: transparent;
}
.project-card__cwd::-webkit-scrollbar-thumb {
  background: var(--border);
}
.project-stats {
  display: flex;
  gap: 1.25rem;
  align-items: baseline;
  flex-wrap: wrap;
}
.project-stats > div {
  display: flex;
  align-items: baseline;
  gap: 0.35rem;
  font-size: 12px;
}
.project-stats strong {
  display: inline;
  margin-top: 0;
}
.status-chip {
  display: inline-flex;
  align-items: center;
  padding: 0.2rem 0.5rem;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  border: 1px solid;
}
.status-chip--active {
  color: var(--green);
  border-color: var(--green);
}

.replay-timeline {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem 0;
  min-height: 240px;
}
.replay-event {
  display: flex;
  gap: 1rem;
  align-items: flex-start;
  opacity: 0;
  animation: fadeInUp 0.3s ease forwards;
}
.replay-event--user {
  flex-direction: row-reverse;
}
.replay-event__time {
  min-width: 60px;
  font-size: 11px;
  color: var(--muted);
}
.replay-event__bubble {
  max-width: 70%;
  padding: 0.65rem 0.85rem;
  line-height: 1.6;
  white-space: pre-wrap;
  position: relative;
  overflow: hidden;
  font-size: 12px;
  border: var(--border-style);
}
.replay-event--user .replay-event__bubble {
  background: rgba(212, 160, 23, 0.08);
  border-color: var(--yellow);
}
.replay-event--assistant .replay-event__bubble {
  background: var(--panel);
  border-color: var(--border);
}
.replay-event--tool .replay-event__bubble {
  background: rgba(45, 122, 58, 0.06);
  border-color: var(--green);
  font-size: 11px;
}
.replay-controls {
  position: sticky;
  bottom: 0;
  background: rgba(253, 251, 245, 0.96);
  backdrop-filter: blur(8px);
  border-top: var(--border-style);
  padding: 0.75rem 1rem;
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-top: 1rem;
}
.replay-progress {
  flex: 1;
  height: 6px;
  background: var(--panel-alt);
  border: 1px solid var(--border);
  cursor: pointer;
  position: relative;
  overflow: hidden;
}
.replay-progress__fill {
  height: 100%;
  background: var(--yellow);
  transition: width 0.1s;
  position: relative;
  z-index: 1;
}
.replay-speed {
  display: flex;
  gap: 4px;
}
.replay-speed button {
  padding: 2px 8px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  cursor: pointer;
  font-size: 11px;
}
.replay-speed button.active {
  background: var(--yellow);
  border-color: var(--yellow);
  color: #fff;
}
@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

.timeline-group {
  border: var(--border-style);
  padding: 0.75rem 1rem;
  background: var(--panel);
}
.timeline-group--user {
  border-left: 3px solid var(--yellow);
}
.timeline-group--assistant {
  border-left: 3px solid var(--border);
}
.timeline-group--tool {
  border-left: 3px solid var(--green);
}
.timeline-role {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--muted);
  margin-bottom: 0.35rem;
}
.timeline-content {
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
.timeline-time {
  font-size: 10px;
  color: var(--muted);
  margin-top: 0.35rem;
}
.timeline-tool-badge {
  display: inline-block;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.15rem 0.4rem;
  border: 1px solid var(--green);
  color: var(--green);
  margin-right: 0.4rem;
}
.md-content pre { white-space: pre-wrap; word-break: break-word; }
.md-content code { font-family: var(--font); }

.sidebar-toggle {
  display: none;
  border: none;
  background: transparent;
  font-size: 20px;
  padding: 0;
  line-height: 1;
  text-transform: none;
  letter-spacing: 0;
}
@media (max-width: 1200px) {
  .card-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}

@media (max-width: 920px) {
  .shell { grid-template-columns: 1fr; height: auto; overflow: visible; }
  .sidebar {
    border-right: 0;
    border-bottom: var(--border-style);
    height: auto;
    position: static;
    overflow: visible;
    padding: 0.75rem 1rem;
  }
  .sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .sidebar-toggle { display: block; }
  .sidebar .nav-group { display: none; }
  .sidebar.open .nav-group { display: block; }
  .brand { margin-bottom: 0; }
  .brand small { display: none; }
  .sidebar.open .brand small { display: block; }
  .content { height: auto; overflow-x: hidden; overflow-y: visible; }
  .card-grid { grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
  .split-layout,
  .stats-grid { grid-template-columns: 1fr; }
  .content { padding: 1rem; }
  .replay-controls { flex-wrap: wrap; }
  .replay-event__bubble { max-width: 100%; }
  .table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  table { min-width: 0; }
  th, td { padding: 0.5rem 0.6rem; font-size: 12px; }
  .table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
}

.session-card {
  cursor: pointer;
  display: grid;
  gap: 0.5rem;
}
.session-card:hover {
  border-color: var(--text);
}
.session-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.session-card__project {
  font-size: 12px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.session-card__stats {
  display: flex;
  gap: 1rem;
  font-size: 11px;
  color: var(--muted);
  flex-wrap: wrap;
}
.session-card__summary {
  font-size: 12px;
  line-height: 1.5;
}

@media (max-width: 640px) {
  .card-grid { grid-template-columns: 1fr; }
  .page-header { flex-direction: column; align-items: flex-start; }
}
`
