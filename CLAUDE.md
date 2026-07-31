# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

**Phase 1 (data/frontend split) is done.** The repo now has:
- [index.html](index.html) — the dashboard frontend. `fetch('data.json')` on load,
  then computes team/total aggregates client-side and calls `initDashboard()`. No
  business data is hardcoded in this file anymore.
- [data.json](data.json) — all business data: `products` (per-product monthly
  arrays + `team` + `excludeFromBillTotal`), `agencyRevenue`, `campaignDetails`,
  `weeklyComparison`/`weeklyProductChanges`, `rawTableHtml` (verbatim KPI-원본-탭
  HTML), and `snapshotHistory`.
- No build step, no package.json — it's static HTML/JS/JSON served as-is. To run
  locally: `npx serve .` (or any static file server) and open the served URL —
  `fetch('data.json')` requires http(s), not `file://`. `.claude/launch.json` has
  a `static-server` config for the browser preview tool.

**Phase 2 (Sync Job) is built.** See [sync/](sync) — `sync.js` fetches the
"미디어사업실_전체" sheet via the Google Sheets API, validates its structure,
and overwrites `data.json`'s `products`/`rawTableHtml`/`quarterlyOverall`/
`updatedAt` (everything else — agencies, campaigns, weeklyComparison,
snapshotHistory — is carried over untouched).
[.github/workflows/sync.yml](.github/workflows/sync.yml) runs it hourly via
`cron` plus `workflow_dispatch` for manual runs. **The `GOOGLE_SERVICE_ACCOUNT_JSON`/
`GOOGLE_SHEET_ID` repo secrets are not set yet**, so the cron will fail until
someone provisions a service account, shares the sheet with it, and adds
those two secrets in the repo's Settings → Secrets. Parsing/validation logic
is proven independently of that via `sync/test/` (`cd sync && npm test`),
which runs against a real captured sheet export, not live credentials.

**Phase 3 (login gate + CI/CD deploy) is done and live.**
- Repo: https://github.com/pinkpooh73/mbo-dashboard (**public** — see note below)
- Live URL: https://pinkpooh73.github.io/mbo-dashboard/ (password: see PRD §4.4 —
  not repeated here since this file may end up published; ask the user or check
  the PRD's private copy)
- [.github/workflows/pages-deploy.yml](.github/workflows/pages-deploy.yml)
  deploys `index.html`+`data.json` only (not the PRDs, `sync/`, or this file)
  to Pages on every push to `main`, and also on `workflow_run` completion of
  `sync.yml` — a plain `push` trigger alone would miss sync-job commits, since
  GitHub suppresses `push`-triggered workflows for commits made with the
  default `GITHUB_TOKEN` (loop prevention).
- **The repo is public, not private.** It was created private first, but this
  GitHub account's plan does not support Pages on private repos (HTTP 422) —
  confirmed live, not assumed. The user chose to switch to public rather than
  upgrade plans. This means the source (including PRDs and `sync/` logic) is
  publicly readable on GitHub; only the *deployed Pages site* is scoped to
  just `index.html`+`data.json` via the workflow's explicit file copy step.
  The password gate is still what's documented in PRD §4.4 as a
  known-weak, view-source-defeatable measure — this didn't change that
  tradeoff, it's an orthogonal repo-visibility issue.
- The login gate (`#gate` in index.html) defers `fetch('data.json')` until
  after a correct password is entered, and persists via
  `localStorage['mbo_dashboard_auth']` so revisits skip it. It does **not**
  protect `data.json` itself from someone who fetches the URL directly —
  this is the exact limitation PRD §4.4/§8 already documents and accepts for
  now.
- Browser/CDN caching note: after a deploy, `fetch('data.json')` from an
  already-open tab may briefly serve a cached copy. The workflow's own deploy
  is verified immediate (checked via `fetch(url, {cache:'no-store'})` against
  the live URL) — this is client-side cache staleness, not a pipeline
  problem. Not addressed yet; a cache-busting query param is a cheap future
  fix if it matters in practice.

See [PRD_미디어사업실_매출관리_대시보드_5Phase_ClaudeCode.md](PRD_미디어사업실_매출관리_대시보드_5Phase_ClaudeCode.md)
(the authoritative, Phase-numbered PRD) for what's next (Phase 4/5); the older
[PRD_미디어사업실_매출관리_대시보드_고도화.md](PRD_미디어사업실_매출관리_대시보드_고도화.md)
is the original draft it superseded — prefer the 5-Phase doc when the two differ.

Read the relevant PRD section in full before starting the next phase of
implementation. The summary below is oriented for a coding agent picking up
work; it is not a replacement for the PRD.

## Commands

- Run the dashboard locally: `npx serve .` from the repo root, then open the served URL (not `file://` — `fetch('data.json')` needs http).
- Run the sync job's test suite (no credentials/network needed): `cd sync && npm test`.
- Run a single sync test file: `cd sync && node --test test/parseSheet.test.js`.
- Offline dry-run of the full parse+merge pipeline against a real captured sheet export (writes to `sync/scripts/dryRun.out.json`, never touches the real `data.json`): `cd sync && node scripts/dryRun.js`.
- Actually run the sync job against the live sheet (requires `GOOGLE_SERVICE_ACCOUNT_JSON` and `GOOGLE_SHEET_ID` env vars — see the Sync Job section below): `cd sync && npm ci && node sync.js`.

## What this project is

A KPI/revenue dashboard for the 미디어사업실 (Media Business Division), currently
operated as a single hand-edited HTML file (`dashboard_YYYYMMDD.html`) with data
values hardcoded into inline JS constants (`PRODS`, `TOTAL`, `TKPIB`, etc.), rebuilt
manually every time by asking Claude to re-read a Google Sheet and regenerate the
file. The PRD's goal is to replace that manual loop with a maintainable, auto-updating
codebase.

## Target architecture (per PRD §3)

```
[Google Sheet] → [Sync Job] → [Data Store(JSON)] → [Frontend] → [GitHub Pages]
```

- **Sync Job**: reads the Google Sheet ("2026년_미디어사업실 매출 관리_v2.0") via the
  Sheets API, normalizes rows into JSON. Starts as hourly polling (simplest, low API
  load); may later move to an Apps Script `onEdit` webhook for near-real-time updates.
- **Data Store**: normalized current data + accumulated historical snapshots, stored
  as committed JSON (DB migration is a non-goal for now).
- **Frontend**: fetches JSON at runtime instead of embedding data in JS constants.
  Must preserve all existing tabs/views (see PRD §4.1): KPI 달성현황, 팀별 실적
  (미디어사업팀/미디어마케팅팀), 대행사별 매출, 월별 캠페인, KPI 데이터 (raw sheet
  view with conditional formatting), 주차별 비교, and the existing pastel design
  system.
- **CI/CD**: GitHub Actions builds/deploys to GitHub Pages on every push to data or
  code (decided in PRD §10 — not an open question).
- **Access control**: a client-side password gate (PRD §4.4). This is explicitly a
  known-weak, temporary measure — the PRD documents that GitHub Pages hosting makes
  the password recoverable via view-source, and plans a Phase 6 migration to
  internal/server-side hosting. Do not "fix" this by inventing stronger client-side
  auth; follow the PRD's documented risk acceptance instead, and flag if asked to
  extend the exposure window.

## Key domain rules (now encoded in code/data, not memory)

- **취급고 총계 제외 규칙**: products with `excludeFromBillTotal: true` in
  `data.json` (currently `용역`, `다윈`) are skipped when [index.html](index.html)'s
  `computeTotal()`/`computeTeam()` sum `act_b`/`kpi_b` for the overall and
  team-level cards/charts. Their real numbers still show in per-product tables
  (e.g. 미디어사업팀 tab's "상품별 실적 상세") and in `rawTableHtml` — only the
  *aggregate* excludes them. `kpi_r`/`act_r` (매출) are never excluded, only
  `kpi_b`/`act_b` (취급고). Don't reintroduce a hardcoded product-name check
  anywhere — always branch on the flag.
- Sheet label text is fragile and has changed before without notice (e.g.
  "취급고" → "취급고(인식x)"). [sync/parseSheet.js](sync/parseSheet.js) validates
  section headers, per-product row-label sequences, and cross-checks
  sum-of-products against the sheet's own total rows — any mismatch throws
  `SheetStructureError` and `sync.js` exits without touching `data.json`. This
  is a named risk in PRD §8, not a hypothetical — see the "(인식x)" handling
  specifically, which is literally the sheet's own signal for the exclusion
  flag (not a hardcoded product-name list).
- New products/rows: [sync/nameAliases.js](sync/nameAliases.js) maps known
  sheet-side labels (which drift from the dashboard's canonical product keys —
  e.g. sheet "스텔라이즈" vs. dashboard "Stellaize") to `{key, team}`. A product
  row the sync job doesn't recognize is **not** dropped or hard-failed — it's
  included with `team: null` and pushed into `data.json.dataQualityWarnings`
  plus a GitHub Actions `::warning::` annotation, satisfying PRD's "최소한
  알림" bar without blocking the numeric update. Add it to `nameAliases.js`
  once you know its team.

## Data model

`data.json` top level: `updatedAt`, `sourceSheetVersion`, `monthsElapsed` (N —
how many months of actuals exist so far this year; drives the "1~N월" cards),
`stellaH1BillOverride` (Stellaize's fixed H1 취급고 진행률, sourced from a sheet
cell rather than computed), `legacy` (unused `bRate`/`rRate` kept for fidelity
with the original export), `quarterlyOverall` (`kpiWon`/`actWon` — a separately
sourced quarterly figure, not derivable from the monthly arrays, kept opaque),
`products` (per-product `team`, monthly `kpi_b`/`kpi_r`/`act_b`/`act_r`, precomputed
`bill`/`rev` percentage arrays, `excludeFromBillTotal`), `agencyRevenue`,
`campaignDetails`, `weeklyComparison`/`weeklyProductChanges` (the current
"주차별 비교" tab's data — still hand-curated, not auto-derived from
`snapshotHistory`; see below), `rawTableHtml`, `snapshotHistory`.

`snapshotHistory` currently has 4 of the 5 intended dates: 2026-07-16, 07-23,
07-24, 07-31 (each `{date, totals, products}`, extracted verbatim from that
date's dashboard export). **2026-07-30 is missing** — no source file matching
that date's `WEEKCMP.cur_label` was found among the historical dashboard
exports; a file named with that date turned out to still be a 7/24 snapshot
internally. Get the real 7/30 figures from the user before fabricating an
entry — don't guess to fill the gap.

`weeklyComparison`/`weeklyProductChanges` are **not** auto-computed from
`snapshotHistory` — the original dashboard's "상품별 주요 변동" list is a
manually curated subset (not "top-N by delta"), so Phase 1 kept it as
pre-baked data to avoid silently changing what's shown. Wiring the weekly
comparison tab to auto-diff the two most recent `snapshotHistory` entries is
Phase 4/5 work, once there's an actual diff-selection algorithm to implement.

## Roadmap phases (PRD §7)

Work is expected to proceed in this order: (1) split hardcoded HTML/JS into
data(JSON)+frontend, (2) build the Sync Job, (3) add the login gate and GitHub
Actions → GitHub Pages deploy, (4) move polling → Apps Script trigger and automate
snapshot history, (5) add error/validation alerting, (6, later) migrate off GitHub
Pages to internal hosting. Don't jump ahead to later-phase infra (e.g. real auth,
webhook triggers) unless asked — the PRD sequences these deliberately so each phase
ships something working.
