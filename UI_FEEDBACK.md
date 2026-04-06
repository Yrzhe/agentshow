# AgentShow Dashboard UI Feedback

Collected 2026-04-06. All items affect both `packages/server` and `packages/worker` (styles.ts, app.ts, page files).

## Priority: High

### 1. Hamburger menu should overlay, not push content down
- **Current**: On mobile (<920px), clicking the hamburger button expands the sidebar and pushes the main content area down.
- **Expected**: Sidebar should overlay on top of the content (position: absolute/fixed + z-index), not displace it.
- **Files**: `styles.ts` (`.sidebar` mobile styles), `app.ts` (`renderNav`)

### 2. Sessions table not adaptive at very narrow widths
- **Current**: `table { min-width: 840px }` causes horizontal scroll at narrow widths. Below the 920px breakpoint the table still requires scrolling and doesn't adapt further.
- **Expected**: At mobile widths, convert the table to a card/stack layout (each session as a vertical card) instead of a horizontal table.
- **Files**: `styles.ts`, `pages/sessions.ts`

### 3. Project card text clipped at medium widths
- **Current**: Between certain breakpoints (roughly 640px-920px), project card content gets clipped because the grid columns are too narrow for the content.
- **Expected**: Smoother transition. Possibly add an intermediate breakpoint or let cards flow naturally.
- **Files**: `styles.ts` (`.card-grid` breakpoints)

## Priority: Medium

### 4. Project card stats should be horizontal, not vertical
- **Current**: Sessions / Tokens / Updated are displayed in a 3-row vertical `.stats-grid` inside each project card, taking too much vertical space.
- **Expected**: Display them in a single horizontal row (inline flex or horizontal grid) to balance the card layout.
- **Files**: `pages/projects.ts` (HTML structure), `styles.ts` (`.stats-grid` inside project cards)

### 5. Project card path (cwd) should be scrollable or wrap
- **Current**: Long paths are truncated with `text-overflow: ellipsis`.
- **Expected**: Either (a) allow the path to wrap to multiple lines within a fixed-height area, or (b) make it horizontally scrollable (`overflow-x: auto; white-space: nowrap`) within a bounded container so the user can scroll to see the full path.
- **Files**: `styles.ts` (`.project-card__cwd`), `pages/projects.ts`

### 6. Other pages mobile adaptation
- **Current**: Several pages (Daily Summary, Usage, Cost Attribution, etc.) haven't been tested at narrow widths and may have similar issues to Sessions.
- **Expected**: Audit all dashboard pages for mobile-friendly rendering. Key areas: tables, card grids, form layouts.
- **Files**: Various page files in `pages/`

## Already Done (this session)

- [x] Cache-Control: no-cache on static assets (serve.ts)
- [x] Hamburger menu + 3-tier breakpoints (1200/920/640px)
- [x] Sessions: project filter clear button with x
- [x] Projects: ended badge + active-first sorting
- [x] Local dev: node direct run instead of Docker (avoids SQLite WAL lock conflicts)
