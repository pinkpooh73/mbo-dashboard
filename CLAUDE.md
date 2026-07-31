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
`updatedAt`/`snapshotHistory` (agencies and campaigns are carried over
untouched — see Phase 4 note on why `weeklyComparison`/`weeklyProductChanges`
no longer exist as data.json fields at all).
**The `GOOGLE_SERVICE_ACCOUNT_JSON`/`GOOGLE_SHEET_ID` repo secrets are still
not set**, so both the cron and the Phase 4 webhook trigger will keep failing
at the "fetch from Sheets API" step until someone provisions a service
account, shares the sheet with it, and adds those two secrets in the repo's
Settings → Secrets. Parsing/validation logic is proven independently of that
via `sync/test/` (`cd sync && npm test`), which runs against a real captured
sheet export, not live credentials.

**Phase 3 (login gate + CI/CD deploy) is done and live.**
- Repo: https://github.com/pinkpooh73/mbo-dashboard (**public** — see note below)
- Live URL: https://pinkpooh73.github.io/mbo-dashboard/ (password: see PRD §4.4 —
  not repeated here since this file may end up published; ask the user or check
  the PRD's private copy)
- [.github/workflows/pages-deploy.yml](.github/workflows/pages-deploy.yml)
  deploys `index.html`+`data.json`+`assets/` only (not the PRDs, `sync/`, or
  this file) to Pages on every push to `main`, and also on `workflow_run` completion of
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

**Phase 4 (near-real-time sync + auto snapshot history) is built.**
- [sync/apps-script/onEditTrigger.gs](sync/apps-script/onEditTrigger.gs): code
  to paste into the Google Sheet's Apps Script editor. Debounces `onEdit`
  bursts (30s) then POSTs a `repository_dispatch` (`sheet-edited`) to GitHub.
  **Not attached to the live sheet yet** — this repo has no Google
  credentials/sheet access, so a human has to do the Apps Script setup (see
  the chat report for the walkthrough); the GitHub-side half of the pipeline
  (dispatch → workflow run) is verified for real, though — an actual
  `repository_dispatch` fired at the repo landed a new Actions run within ~3
  seconds.
- `sync.yml` keeps the hourly cron as a fallback alongside the new
  `repository_dispatch` trigger — deliberately not replaced. Reasoning: if
  the Apps Script trigger silently stops firing (Google account
  reauthorization needed, trigger quota, someone deletes the trigger), the
  dashboard would otherwise go stale with no visible symptom. Worst case with
  both paths is the old 1h staleness; best case is under a minute.
- `sync/mergeSnapshot.js`: `sync.js` now appends the freshly-synced products
  into `data.json.snapshotHistory` on every successful run, keyed by
  Asia/Seoul calendar date — **at most one entry per day** (same-day resyncs
  overwrite that day's entry in place). This matters now that syncs can
  happen many times a day: appending unconditionally would make "주차별"
  comparisons meaningless (comparing two syncs a minute apart) and grow
  `data.json` unbounded.
- [index.html](index.html)'s `computeWeeklyComparison()`/
  `computeWeeklyProductChanges()` derive "주차별 핵심 지표 비교" /
  "상품별 주요 변동" from the two most recent `snapshotHistory` entries at
  render time — `data.json` no longer has `weeklyComparison`/
  `weeklyProductChanges` fields, and nothing hand-curates them anymore. The
  product-change list is *every* product whose current-month `act_b` moved
  between the two snapshots, sorted by |delta| descending, not a fixed
  top-N — verified this exactly reproduces the old hand-curated 7/24→7/31
  list (same products, same order) before removing the manual data.

**Phase 5 (stabilization: anomaly alerts, product metadata, docs) is built.**
- **[business-rules.md](business-rules.md) is the canonical explanation of
  every calculation rule** (units, the 취급고 exclusion flag, "1~N월",
  snapshot dedup, anomaly thresholds) — read it before touching any
  aggregate calculation, and update it when the logic changes. This
  CLAUDE.md file is oriented at "what's built and where," business-rules.md
  is oriented at "why the numbers come out the way they do."
- [sync/productConfig.json](sync/productConfig.json): product name-mapping
  + team assignment moved out of `nameAliases.js` code into this JSON file
  specifically so a non-engineer can add a new product with one line, no JS
  required (see business-rules.md §3 for the exact procedure).
  `nameAliases.js` is now just a thin loader over it.
- [sync/detectAnomalies.js](sync/detectAnomalies.js): flags (a) a product's
  취급고 exactly equaling 매출 when that's *not* its usual pattern (compares
  against its own prior months — a product like Stellaize that's *always*
  bill===rev is correctly never flagged; this was caught and fixed via a
  test against the real data before shipping), and (b) >=5x / <=0.2x
  month-over-month swings, excluding 0→N (new activation) and N→0 (reads as
  "not entered yet" in this sheet, not a data error — also caught via a real
  false-positive against live July data before shipping, see the file's
  comments). Takes an explicit `monthIdx` rather than inferring "current
  month" from the data — a real bug during development: 용역 has figures
  pre-filled through December, which made data-inferred "latest month"
  wrong for every other product.
- [sync/notify.js](sync/notify.js): sends anomalies to Slack via
  `SLACK_WEBHOOK_URL` (GitHub Actions secret, not set yet — ask the user for
  it, then `gh secret set SLACK_WEBHOOK_URL`). Missing webhook = anomalies
  still show up as `::warning::` annotations on the Actions run, sync itself
  never fails because of an anomaly or a notification-delivery problem.

See [PRD_미디어사업실_매출관리_대시보드_5Phase_ClaudeCode.md](PRD_미디어사업실_매출관리_대시보드_5Phase_ClaudeCode.md)
(the authoritative, Phase-numbered PRD) for what's next; the older
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
  Sheets API, normalizes rows into JSON. Runs on an hourly cron (fallback) plus
  a `repository_dispatch` fired by an Apps Script `onEdit` trigger (Phase 4)
  for near-real-time updates.
- **Data Store**: normalized current data + accumulated historical snapshots, stored
  as committed JSON (DB migration is a non-goal for now). `snapshotHistory` accumulates
  automatically now (Phase 4) — one entry per calendar date, no manual curation.
- **Frontend**: fetches JSON at runtime instead of embedding data in JS constants.
  Must preserve all existing tabs/views (see PRD §4.1): KPI 달성현황, 팀별 실적
  (미디어사업팀/미디어마케팅팀), 대행사별 매출, 월별 캠페인, KPI 데이터 (raw sheet
  view with conditional formatting), 주차별 비교. The visual design system was
  intentionally overhauled in a later session (Vuexy-inspired sidebar layout) —
  "preserve the existing design" no longer means the original Phase 1 pastel
  look, it means whatever's currently in `index.html`; functionality/data
  bindings are what must stay intact across restyles, not specific colors/layout.
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

`data.json` top level: `updatedAt`, `sourceSheetVersion`, `monthsElapsed`
(legacy/unused since Phase 4 — `index.html` now computes N itself from the
current calendar date instead of reading this field), `stellaH1BillOverride`
(Stellaize's fixed H1 취급고 진행률, sourced from a sheet cell rather than
computed), `legacy` (unused `bRate`/`rRate` kept for fidelity with the
original export), `quarterlyOverall` (`kpiWon`/`actWon` — a separately
sourced quarterly figure, not derivable from the monthly arrays, kept opaque),
`products` (per-product `team`, monthly `kpi_b`/`kpi_r`/`act_b`/`act_r`, precomputed
`bill`/`rev` percentage arrays, `excludeFromBillTotal`), `agencyRevenue`,
`campaignDetails`, `rawTableHtml`, `snapshotHistory`. There is **no**
`weeklyComparison`/`weeklyProductChanges` field anymore (Phase 4 — see
above); don't reintroduce it as a stored field, it's derived data now.

`snapshotHistory` accumulates automatically as of Phase 4
([sync/mergeSnapshot.js](sync/mergeSnapshot.js), one entry per Asia/Seoul
calendar date). It currently has 4 manually-seeded historical dates from
before that: 2026-07-16, 07-23, 07-24, 07-31 (each `{date, products}` —
products keyed by name with `team`/`kpi_b`/`kpi_r`/`act_b`/`act_r`/
`excludeFromBillTotal`). **2026-07-30 is still missing** from that
manually-seeded set — no source file matching that date was ever found among
the historical dashboard exports (see git history for the Phase 1
investigation) — but this no longer blocks anything going forward; every
sync fills in the next date on its own now.

"주차별 핵심 지표 비교" / "상품별 주요 변동" (`WEEKCMP`/`WEEKPROD` in
`index.html`) are computed client-side by `computeWeeklyComparison()`/
`computeWeeklyProductChanges()` from the two most recent `snapshotHistory`
entries — see the Phase 4 section above for the selection rule (every
product with a nonzero current-month delta, sorted by |delta|, not a fixed
top-N — verified against the real hand-curated 7/24→7/31 data before the
manual version was removed).

## Roadmap phases (PRD §7)

Work is expected to proceed in this order: (1) split hardcoded HTML/JS into
data(JSON)+frontend, (2) build the Sync Job, (3) add the login gate and GitHub
Actions → GitHub Pages deploy, (4) move polling → Apps Script trigger and automate
snapshot history, (5) add error/validation alerting, (6, later) migrate off GitHub
Pages to internal hosting. Don't jump ahead to later-phase infra (e.g. real auth,
webhook triggers) unless asked — the PRD sequences these deliberately so each phase
ships something working.
