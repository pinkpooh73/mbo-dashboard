'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { appendSnapshot, seoulDateString } = require('../mergeSnapshot');

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

test('seoulDateString uses the Asia/Seoul calendar date, not UTC', () => {
  // 2026-08-01 00:30 KST = 2026-07-31 15:30 UTC — a naive UTC formatter would say 07-31
  const kstJustAfterMidnight = new Date('2026-07-31T15:30:00Z');
  assert.equal(seoulDateString(kstJustAfterMidnight), '2026-08-01');
});
