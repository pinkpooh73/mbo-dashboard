'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { detectAnomalies, seoulMonthIndex } = require('../detectAnomalies');

const Z12 = () => new Array(12).fill(0);
const JUNE = 5; // 0-based month index used throughout — explicit, not wall-clock-derived

function product(overrides) {
  return Object.assign(
    { team: 'biz', kpi_b: Z12(), kpi_r: Z12(), act_b: Z12(), act_r: Z12(), excludeFromBillTotal: false },
    overrides
  );
}

test('a product whose bill has always equaled revenue (e.g. Stellaize) is NOT flagged', () => {
  // 6 months reported, all with act_b === act_r — this is just how the product works.
  const act = [100, 200, 150, 80, 90, 120, 0, 0, 0, 0, 0, 0];
  const products = { 'Stellaize': product({ act_b: act.slice(), act_r: act.slice() }) };
  const anomalies = detectAnomalies(products, JUNE);
  assert.equal(anomalies.filter((a) => a.type === 'BILL_EQUALS_REV').length, 0);
});

test('a product that suddenly becomes bill===revenue after normally differing IS flagged', () => {
  const act_b = [100, 110, 105, 95, 100, 90, 0, 0, 0, 0, 0, 0];
  const act_r = [60, 65, 62, 58, 61, 90, 0, 0, 0, 0, 0, 0]; // month 6 (idx5=JUNE) matches act_b, months 1-5 don't
  const products = { '비즈챗': product({ act_b, act_r }) };
  const anomalies = detectAnomalies(products, JUNE);
  const hit = anomalies.find((a) => a.type === 'BILL_EQUALS_REV');
  assert.ok(hit, 'expected a BILL_EQUALS_REV anomaly');
  assert.equal(hit.month, 6);
  assert.equal(hit.product, '비즈챗');
});

test('the very first reported month cannot be judged against history, so it is not flagged', () => {
  const act_b = [100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const act_r = [100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const products = { '신상품': product({ act_b, act_r }) };
  const anomalies = detectAnomalies(products, 0); // January, no prior history at all
  assert.equal(anomalies.filter((a) => a.type === 'BILL_EQUALS_REV').length, 0);
});

test('a >=5x month-over-month spike is flagged', () => {
  const act_b = [100, 100, 100, 100, 100, 600, 0, 0, 0, 0, 0, 0]; // 100 -> 600, 6x
  const products = { '옥외광고': product({ act_b, act_r: Z12() }) };
  const anomalies = detectAnomalies(products, JUNE);
  const hit = anomalies.find((a) => a.type === 'MONTH_OVER_MONTH_SPIKE' && a.field === 'act_b');
  assert.ok(hit);
  assert.equal(hit.prev, 100);
  assert.equal(hit.cur, 600);
});

test('a <=0.2x month-over-month drop is flagged', () => {
  const act_r = [500, 500, 500, 500, 500, 50, 0, 0, 0, 0, 0, 0]; // 500 -> 50, 0.1x
  const products = { 'RMN': product({ act_b: Z12(), act_r }) };
  const anomalies = detectAnomalies(products, JUNE);
  const hit = anomalies.find((a) => a.type === 'MONTH_OVER_MONTH_SPIKE' && a.field === 'act_r');
  assert.ok(hit);
});

test('a normal, moderate month-over-month change is NOT flagged', () => {
  const act_b = [100, 100, 100, 100, 100, 140, 0, 0, 0, 0, 0, 0]; // +40%, unremarkable
  const products = { '들리고': product({ act_b, act_r: Z12() }) };
  const anomalies = detectAnomalies(products, JUNE);
  assert.equal(anomalies.filter((a) => a.type === 'MONTH_OVER_MONTH_SPIKE').length, 0);
});

test('a brand-new product activating from 0 is NOT treated as a spike', () => {
  const act_b = [0, 0, 0, 0, 0, 300, 0, 0, 0, 0, 0, 0]; // 0 -> 300 is normal "신규", not a spike
  const products = { '신규상품': product({ act_b, act_r: Z12() }) };
  const anomalies = detectAnomalies(products, JUNE);
  assert.equal(anomalies.filter((a) => a.type === 'MONTH_OVER_MONTH_SPIKE').length, 0);
});

test('a product with data pre-filled into future months does not fool the "current month" — caller-supplied monthIdx wins', () => {
  // Regression test: 용역 in the real sheet has a flat recurring value filled
  // in all the way to December well before those months happen. If the
  // reporting month were inferred from "last nonzero value in the data"
  // instead of taken from the caller, this would silently shift anomaly
  // comparisons to a month that hasn't happened yet for every other product.
  const act_b = [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100]; // filled through Dec
  const products = { '용역': product({ act_b, act_r: act_b.slice(), excludeFromBillTotal: true }) };
  // Caller says "we're only in June" (idx5) — must not be overridden by the Dec-filled data.
  const anomalies = detectAnomalies(products, JUNE);
  anomalies.forEach((a) => assert.equal(a.month, 6, 'must anchor on the supplied month, not December'));
});

test('seoulMonthIndex reflects the Asia/Seoul calendar month, not UTC', () => {
  // 2026-08-01 00:30 KST = 2026-07-31 15:30 UTC — a naive UTC formatter would say July (index 6)
  const kstJustAfterMidnight = new Date('2026-07-31T15:30:00Z');
  assert.equal(seoulMonthIndex(kstJustAfterMidnight), 7); // August, 0-based
});

test('real 2026-07-31 data.json: Stellaize (always bill===rev) produces no false positive', () => {
  const data = require('../../data.json');
  // Real data as of the 7/31 sync — July is month index 6.
  const anomalies = detectAnomalies(data.products, 6);
  const stellaHits = anomalies.filter((a) => a.product === 'Stellaize' && a.type === 'BILL_EQUALS_REV');
  assert.equal(stellaHits.length, 0, 'Stellaize legitimately always has bill===rev, must not alert every sync');
});

test('real 2026-07-31 data.json produces zero anomalies at the correct calendar month (clean baseline)', () => {
  const data = require('../../data.json');
  const anomalies = detectAnomalies(data.products, 6);
  assert.deepEqual(anomalies, []);
});
