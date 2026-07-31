'use strict';
// Appends a snapshot of the freshly-synced products into snapshotHistory.
//
// Phase 4: snapshotHistory is now the single source of truth for "주차별
// 비교" — the frontend derives WEEKCMP/WEEKPROD from its two most recent
// entries at render time (see computeWeeklyComparison/computeWeeklyProductChanges
// in index.html), so this is the only place that needs to append new data
// points. Nothing else needs to hand-curate a weekly comparison anymore.
//
// At most one entry per calendar date (Asia/Seoul) is kept. Phase 4 moves
// sync from hourly to near-real-time (Apps Script webhook), and appending a
// new entry on every single sync would make "주차별" comparisons meaningless
// (comparing two syncs a minute apart) and bloat data.json indefinitely.
// Today's entry is simply overwritten in place on every sync until the date
// rolls over at local midnight.

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
 * @param {Array} snapshotHistory - existing data.json.snapshotHistory (may be undefined)
 * @param {Object} products - result.products from parseSheet(), already in 만원 units
 * @param {Date} [now] - injectable for tests; defaults to the current time
 * @returns {Array} new snapshotHistory array, sorted ascending by date
 */
function appendSnapshot(snapshotHistory, products, now) {
  const date = seoulDateString(now || new Date());
  const history = (snapshotHistory || []).slice();
  const entry = { date, products: snapshotProducts(products) };
  const idx = history.findIndex((s) => s.date === date);
  if (idx >= 0) history[idx] = entry;
  else history.push(entry);
  history.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return history;
}

module.exports = { appendSnapshot, seoulDateString, snapshotProducts };
