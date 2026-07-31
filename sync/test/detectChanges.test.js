'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { detectChanges, stableStringify } = require('../detectChanges');

function baseData() {
  return {
    updatedAt: '2026-07-31T00:00:00.000Z',
    sourceSheetVersion: 'v2.0',
    monthsElapsed: 7,
    products: {
      '비즈링': { team: 'biz', kpi_b: [1, 2], kpi_r: [1, 2], act_b: [1, 2], act_r: [1, 2], bill: [0, 0], rev: [0, 0], excludeFromBillTotal: false }
    },
    quarterlyOverall: { kpiWon: [1], actWon: [1] },
    dataQualityWarnings: [],
    dataQualityAnomalies: [],
    agencyRevenue: { a: 1 },
    campaignDetails: { c: 1 },
    snapshotHistory: [{ date: '2026-07-31', products: {} }]
  };
}

// candidate = what sync.js would write, i.e. the same object minus updatedAt
function candidateFrom(data) {
  const c = JSON.parse(JSON.stringify(data));
  delete c.updatedAt;
  return c;
}

const RAW = '<table><tr><td>1</td></tr></table>';

test('identical data + identical raw html = no change (the no-op sync case)', () => {
  const existing = baseData();
  const { changed, reasons } = detectChanges(existing, candidateFrom(existing), {
    existingRawHtml: RAW,
    newRawHtml: RAW
  });
  assert.equal(changed, false, reasons.join(' | '));
  assert.deepEqual(reasons, []);
});

test('a newer updatedAt alone is NOT a change (this was the whole bug)', () => {
  const existing = baseData();
  const candidate = candidateFrom(existing);
  candidate.updatedAt = new Date().toISOString(); // even if someone stamps it early
  const { changed } = detectChanges(existing, candidate, { existingRawHtml: RAW, newRawHtml: RAW });
  assert.equal(changed, false);
});

test('a changed product figure is a change', () => {
  const existing = baseData();
  const candidate = candidateFrom(existing);
  candidate.products['비즈링'].act_b[1] = 999;
  const { changed, reasons } = detectChanges(existing, candidate, { existingRawHtml: RAW, newRawHtml: RAW });
  assert.equal(changed, true);
  assert.ok(reasons.some((r) => r.includes('products')));
});

test('a brand-new product is reported by name, not just as "products 변경"', () => {
  const existing = baseData();
  const candidate = candidateFrom(existing);
  candidate.products['신규상품'] = { team: null, kpi_b: [0], kpi_r: [0], act_b: [7], act_r: [7], bill: [0], rev: [0], excludeFromBillTotal: false };
  const { changed, reasons } = detectChanges(existing, candidate, { existingRawHtml: RAW, newRawHtml: RAW });
  assert.equal(changed, true);
  assert.ok(reasons.some((r) => r.includes('신규 상품') && r.includes('신규상품')), reasons.join(' | '));
});

test('a disappearing product is reported too', () => {
  const existing = baseData();
  const candidate = candidateFrom(existing);
  delete candidate.products['비즈링'];
  const { changed, reasons } = detectChanges(existing, candidate, { existingRawHtml: RAW, newRawHtml: RAW });
  assert.equal(changed, true);
  assert.ok(reasons.some((r) => r.includes('사라짐')), reasons.join(' | '));
});

test('a snapshotHistory entry for a NEW date is a change (first sync of the day)', () => {
  const existing = baseData();
  const candidate = candidateFrom(existing);
  candidate.snapshotHistory.push({ date: '2026-08-01', products: {} });
  const { changed, reasons } = detectChanges(existing, candidate, { existingRawHtml: RAW, newRawHtml: RAW });
  assert.equal(changed, true);
  assert.ok(reasons.some((r) => r.includes('snapshotHistory')));
});

test('a same-day snapshot overwrite with identical figures is NOT a change', () => {
  // The common case under Phase 4's webhook: several syncs a day, same numbers.
  const existing = baseData();
  const candidate = candidateFrom(existing); // appendSnapshot rewrote today's entry with equal content
  const { changed } = detectChanges(existing, candidate, { existingRawHtml: RAW, newRawHtml: RAW });
  assert.equal(changed, false);
});

test('a retention trim of old snapshots is a change (the file must be rewritten smaller)', () => {
  const existing = baseData();
  existing.snapshotHistory = [{ date: '2025-01-01', products: {} }, { date: '2026-07-31', products: {} }];
  const candidate = candidateFrom(existing);
  candidate.snapshotHistory = [{ date: '2026-07-31', products: {} }];
  const { changed, reasons } = detectChanges(existing, candidate, { existingRawHtml: RAW, newRawHtml: RAW });
  assert.equal(changed, true);
  assert.ok(reasons.some((r) => r.includes('snapshotHistory')));
});

test('new warnings/anomalies count as a change even when the figures are identical', () => {
  const existing = baseData();
  let candidate = candidateFrom(existing);
  candidate.dataQualityWarnings = ['신규/미분류 상품 발견: "미등록"'];
  assert.equal(detectChanges(existing, candidate, { existingRawHtml: RAW, newRawHtml: RAW }).changed, true);

  candidate = candidateFrom(existing);
  candidate.dataQualityAnomalies = [{ type: 'spike', detail: '...' }];
  assert.equal(detectChanges(existing, candidate, { existingRawHtml: RAW, newRawHtml: RAW }).changed, true);
});

test('a changed quarterlyOverall counts as a change', () => {
  const existing = baseData();
  const candidate = candidateFrom(existing);
  candidate.quarterlyOverall.actWon = [2];
  assert.equal(detectChanges(existing, candidate, { existingRawHtml: RAW, newRawHtml: RAW }).changed, true);
});

test('changed raw table HTML alone is a change (KPI 데이터 탭도 최신이어야 하므로)', () => {
  const existing = baseData();
  const candidate = candidateFrom(existing);
  const { changed, reasons } = detectChanges(existing, candidate, {
    existingRawHtml: RAW,
    newRawHtml: RAW + '<!-- new row -->'
  });
  assert.equal(changed, true);
  assert.ok(reasons.some((r) => r.includes('raw-table.html')));
});

test('a missing raw-table.html forces a write even if data.json is identical', () => {
  const existing = baseData();
  const candidate = candidateFrom(existing);
  const { changed, reasons } = detectChanges(existing, candidate, {
    existingRawHtml: null,
    newRawHtml: RAW
  });
  assert.equal(changed, true);
  assert.ok(reasons.some((r) => r.includes('raw-table.html')));
});

test('a data.json still carrying the legacy inline rawTableHtml is rewritten to drop it', () => {
  const existing = baseData();
  existing.rawTableHtml = '<table>...117KB...</table>';
  const candidate = candidateFrom(baseData()); // sync deletes the field
  const { changed, reasons } = detectChanges(existing, candidate, { existingRawHtml: RAW, newRawHtml: RAW });
  assert.equal(changed, true);
  assert.ok(reasons.some((r) => r.includes('rawTableHtml')), reasons.join(' | '));
});

test('fields the sync job does not own are ignored (carried over verbatim anyway)', () => {
  const existing = baseData();
  const candidate = candidateFrom(existing);
  candidate.agencyRevenue = { a: 999 }; // sync never does this, but if it did it is not "material"
  candidate.monthsElapsed = 12;
  assert.equal(detectChanges(existing, candidate, { existingRawHtml: RAW, newRawHtml: RAW }).changed, false);
});

test('key order does not matter — a reordered product object is not a change', () => {
  const existing = baseData();
  const candidate = candidateFrom(existing);
  const p = candidate.products['비즈링'];
  candidate.products['비즈링'] = {
    excludeFromBillTotal: p.excludeFromBillTotal, rev: p.rev, bill: p.bill,
    act_r: p.act_r, act_b: p.act_b, kpi_r: p.kpi_r, kpi_b: p.kpi_b, team: p.team
  };
  assert.equal(detectChanges(existing, candidate, { existingRawHtml: RAW, newRawHtml: RAW }).changed, false);
  // ...but array order still matters, since months are positional.
  candidate.products['비즈링'].act_b = [2, 1];
  assert.equal(detectChanges(existing, candidate, { existingRawHtml: RAW, newRawHtml: RAW }).changed, true);
});

test('a first run against a data.json that predates these fields writes (undefined != [])', () => {
  const existing = baseData();
  delete existing.dataQualityWarnings;
  delete existing.dataQualityAnomalies;
  const candidate = candidateFrom(baseData());
  const { changed } = detectChanges(existing, candidate, { existingRawHtml: RAW, newRawHtml: RAW });
  assert.equal(changed, true);
});

test('stableStringify distinguishes undefined from null and from an empty array', () => {
  assert.notEqual(stableStringify(undefined), stableStringify(null));
  assert.notEqual(stableStringify(undefined), stableStringify([]));
  assert.equal(stableStringify({ a: 1, b: 2 }), stableStringify({ b: 2, a: 1 }));
});
