'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  appendSnapshot,
  seoulDateString,
  RETENTION_DAYS,
  MIN_KEPT_ENTRIES
} = require('../mergeSnapshot');

// 'YYYY-MM-DD' for `days` before the given reference date.
function daysBefore(refIso, days) {
  const d = new Date(refIso);
  d.setUTCDate(d.getUTCDate() - days);
  return seoulDateString(d);
}

const sampleProducts = {
  '비즈링': { team: 'biz', kpi_b: [1], kpi_r: [1], act_b: [1], act_r: [1], excludeFromBillTotal: false },
  '용역': { team: 'biz', kpi_b: [0], kpi_r: [1], act_b: [2], act_r: [2], excludeFromBillTotal: true }
};

test('appends a new entry when the date is not already present', () => {
  const existing = [{ date: '2026-07-24', products: {} }];
  const now = new Date('2026-07-31T09:00:00+09:00');
  const result = appendSnapshot(existing, sampleProducts, now);
  assert.equal(result.length, 2);
  assert.equal(result[result.length - 1].date, '2026-07-31');
  assert.deepEqual(Object.keys(result[result.length - 1].products).sort(), ['비즈링', '용역']);
});

test('overwrites (does not duplicate) an entry for a date that already exists — same-day resync', () => {
  const existing = [
    { date: '2026-07-30', products: {} },
    { date: '2026-07-31', products: { '비즈링': { team: 'biz', kpi_b: [999], kpi_r: [999], act_b: [999], act_r: [999], excludeFromBillTotal: false } } }
  ];
  const now = new Date('2026-07-31T15:00:00+09:00'); // later sync, same Seoul date
  const result = appendSnapshot(existing, sampleProducts, now);
  assert.equal(result.length, 2, 'should not grow — same date overwritten in place');
  const todays = result.find((s) => s.date === '2026-07-31');
  assert.equal(todays.products['비즈링'].kpi_b[0], 1, 'should reflect the newest sync, not the stale one');
});

test('keeps snapshotHistory sorted ascending by date regardless of input order', () => {
  const existing = [
    { date: '2026-07-31', products: {} },
    { date: '2026-07-16', products: {} }
  ];
  const now = new Date('2026-07-24T09:00:00+09:00');
  const result = appendSnapshot(existing, sampleProducts, now);
  assert.deepEqual(result.map((s) => s.date), ['2026-07-16', '2026-07-24', '2026-07-31']);
});

test('starts a fresh history when snapshotHistory is missing/undefined', () => {
  const now = new Date('2026-08-01T00:05:00+09:00');
  const result = appendSnapshot(undefined, sampleProducts, now);
  assert.equal(result.length, 1);
  assert.equal(result[0].date, '2026-08-01');
});

test('snapshot only keeps the fields the frontend actually needs (no bill/rev % noise)', () => {
  const result = appendSnapshot([], sampleProducts, new Date('2026-07-31T09:00:00+09:00'));
  const p = result[0].products['용역'];
  assert.deepEqual(Object.keys(p).sort(), ['act_b', 'act_r', 'excludeFromBillTotal', 'kpi_b', 'kpi_r', 'team']);
  assert.equal(p.excludeFromBillTotal, true);
});

test(`drops entries older than ${RETENTION_DAYS} days and keeps recent ones`, () => {
  const nowIso = '2026-07-31T09:00:00+09:00';
  const existing = [
    { date: daysBefore(nowIso, 400), products: {} }, // way past retention
    { date: daysBefore(nowIso, 120), products: {} }, // past retention
    { date: daysBefore(nowIso, RETENTION_DAYS + 1), products: {} }, // just past the cutoff
    { date: daysBefore(nowIso, RETENTION_DAYS - 1), products: {} }, // just inside
    { date: daysBefore(nowIso, 7), products: {} } // recent
  ];
  const result = appendSnapshot(existing, sampleProducts, new Date(nowIso));
  const dates = result.map((s) => s.date);
  assert.deepEqual(dates, [
    daysBefore(nowIso, RETENTION_DAYS - 1),
    daysBefore(nowIso, 7),
    '2026-07-31'
  ], 'only entries within the retention window (plus today) survive');
});

test('retention keeps the freshly appended entry even when everything else is old', () => {
  const nowIso = '2026-07-31T09:00:00+09:00';
  const existing = [{ date: daysBefore(nowIso, 365), products: {} }];
  const result = appendSnapshot(existing, sampleProducts, new Date(nowIso));
  assert.ok(result.some((s) => s.date === '2026-07-31'), "today's entry must never be pruned");
});

test(`never prunes below ${MIN_KEPT_ENTRIES} entries, so 주차별 비교 always has something to compare`, () => {
  // Sync stopped for a year, then resumed: an age-only filter would leave a
  // single entry and the frontend's latestTwoSnapshots() would come up empty.
  const nowIso = '2026-07-31T09:00:00+09:00';
  const existing = [
    { date: daysBefore(nowIso, 400), products: {} },
    { date: daysBefore(nowIso, 380), products: {} }
  ];
  const result = appendSnapshot(existing, sampleProducts, new Date(nowIso));
  assert.equal(result.length, MIN_KEPT_ENTRIES);
  assert.equal(result[result.length - 1].date, '2026-07-31');
  assert.equal(result[0].date, daysBefore(nowIso, 380), 'keeps the most recent of the stale ones');
});

test('a history entirely inside the retention window is left intact', () => {
  const existing = [
    { date: '2026-07-16', products: {} },
    { date: '2026-07-23', products: {} },
    { date: '2026-07-24', products: {} }
  ];
  const result = appendSnapshot(existing, sampleProducts, new Date('2026-07-31T09:00:00+09:00'));
  assert.deepEqual(result.map((s) => s.date), ['2026-07-16', '2026-07-23', '2026-07-24', '2026-07-31']);
});

test('seoulDateString uses the Asia/Seoul calendar date, not UTC', () => {
  // 2026-08-01 00:30 KST = 2026-07-31 15:30 UTC — a naive UTC formatter would say 07-31
  const kstJustAfterMidnight = new Date('2026-07-31T15:30:00Z');
  assert.equal(seoulDateString(kstJustAfterMidnight), '2026-08-01');
});
