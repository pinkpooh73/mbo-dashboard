'use strict';
// Appends a snapshot of the freshly-synced products into snapshotHistory.
//
// Phase 4: snapshotHistory is now the single source of truth for "주차별
// 비교" — the frontend derives WEEKCMP/WEEKPROD from it at render time (see
// computeWeeklyComparison/computeWeeklyProductChanges in compute.js), so this
// is the only place that needs to append new data points. Nothing else needs
// to hand-curate a weekly comparison anymore. As of the scheduled-sync-driven
// daily accumulation, the frontend picks the two most recent *Friday*
// entries specifically (latestTwoFridaySnapshots() in compute.js) rather
// than simply the two most recent entries — otherwise a "주차별" comparison
// would reshuffle on every weekday sync instead of holding steady week to
// week.
//
// At most one entry per calendar date (Asia/Seoul) is kept. Phase 4 moves
// sync from hourly to near-real-time (Apps Script webhook), and appending a
// new entry on every single sync would make "주차별" comparisons meaningless
// (comparing two syncs a minute apart) and bloat data.json indefinitely.
// Today's entry is simply overwritten in place on every sync until the date
// rolls over at local midnight. Entries older than RETENTION_DAYS are dropped
// (see below) so the file stays bounded in the long run too, not just per-day.

// Retention: one entry/day is bounded per-day but unbounded over time (~3.5KB
// a day => ~1.2MB a year in a file every dashboard visitor downloads). The
// frontend only ever reads two Friday entries out of this history
// (latestTwoFridaySnapshots()), so anything older is kept purely for future
// trend/history work — 90 days (약 3개월, 분기 단위 회고에 충분, and comfortably
// more than the ~2 weeks the Friday comparison actually needs) is the cap.
const RETENTION_DAYS = 90;
// ...but never trim below this many entries, even if every one of them is
// older than the cutoff. If syncing stops for >90 days and then resumes, a
// naive age filter would leave exactly one entry (today's) and the "주차별
// 비교" view would silently have nothing to compare against.
const MIN_KEPT_ENTRIES = 2;

function seoulDateString(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
}

function snapshotProducts(products) {
  const out = {};
  for (const [name, p] of Object.entries(products)) {
    out[name] = {
      team: p.team,
      kpi_b: p.kpi_b,
      kpi_r: p.kpi_r,
      act_b: p.act_b,
      act_r: p.act_r,
      excludeFromBillTotal: p.excludeFromBillTotal
    };
  }
  return out;
}

/**
 * Drops entries older than RETENTION_DAYS relative to `now`, keeping at least
 * MIN_KEPT_ENTRIES of the most recent ones regardless of age.
 * Dates are 'YYYY-MM-DD', so plain string comparison is a valid date ordering.
 * @param {Array} history - already sorted ascending by date
 * @param {Date} now
 */
function pruneOldSnapshots(history, now) {
  const cutoffMs = now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const cutoff = seoulDateString(new Date(cutoffMs));
  const kept = history.filter((s) => s.date >= cutoff);
  if (kept.length >= MIN_KEPT_ENTRIES) return kept;
  return history.slice(-MIN_KEPT_ENTRIES);
}

/**
 * @param {Array} snapshotHistory - existing data.json.snapshotHistory (may be undefined)
 * @param {Object} products - result.products from parseSheet(), already in 만원 units
 * @param {Date} [now] - injectable for tests; defaults to the current time
 * @returns {Array} new snapshotHistory array, sorted ascending by date, capped
 *   at RETENTION_DAYS of history
 */
function appendSnapshot(snapshotHistory, products, now) {
  const at = now || new Date();
  const date = seoulDateString(at);
  const history = (snapshotHistory || []).slice();
  const entry = { date, products: snapshotProducts(products) };
  const idx = history.findIndex((s) => s.date === date);
  if (idx >= 0) history[idx] = entry;
  else history.push(entry);
  history.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return pruneOldSnapshots(history, at);
}

module.exports = {
  appendSnapshot,
  pruneOldSnapshots,
  seoulDateString,
  snapshotProducts,
  RETENTION_DAYS,
  MIN_KEPT_ENTRIES
};
