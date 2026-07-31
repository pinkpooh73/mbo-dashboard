'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSheet, SheetStructureError } = require('../parseSheet');

const FIXTURE = require('./fixtures/sheet_20260731.json');

// Deep-clone helper so each test mutates its own copy of the fixture.
function clone(rows) {
  return rows.map((r) => r.slice());
}

function findRow(rows, colCVal, colDVal) {
  return rows.findIndex((r) => (r[2] || '').trim() === colCVal && (r[3] || '').trim() === colDVal);
}

test('parses the real 2026-07-31 sheet export without warnings', () => {
  const result = parseSheet(clone(FIXTURE));
  assert.equal(result.warnings.length, 0);
  assert.equal(Object.keys(result.products).length, 12);
  assert.equal(result.products['용역'].excludeFromBillTotal, true);
  assert.equal(result.products['다윈'].excludeFromBillTotal, true);
  assert.equal(result.products['비즈링'].excludeFromBillTotal, false);
  assert.equal(result.products['용역'].team, 'biz');
  assert.equal(result.products['다윈'].team, 'mkt');
  // cross-check totals line up with the sheet's own total rows (won-scale)
  assert.ok(result.totalsCheck.diffs.actB <= 20000);
  assert.ok(result.totalsCheck.diffs.actR <= 20000);
});

test('a product\'s real 취급고 실적 is still exposed even when excluded from bill totals', () => {
  const result = parseSheet(clone(FIXTURE));
  const yongyeok = result.products['용역'];
  assert.equal(yongyeok.excludeFromBillTotal, true);
  assert.ok(yongyeok.act_b.some((v) => v > 0), 'act_b should carry real figures, not be zeroed out');
});

test('removing the "(인식x)" suffix flips excludeFromBillTotal to false', () => {
  const rows = clone(FIXTURE);
  const idx = rows.findIndex((r) => (r[3] || '').trim() === '취급고(인식x)');
  assert.ok(idx >= 0, 'fixture should contain a 취급고(인식x) row');
  rows[idx] = rows[idx].slice();
  rows[idx][3] = '취급고'; // sheet label changed — first occurrence is 용역
  // If this exclusion really lifted on the live sheet, the sheet's own
  // "매출 Total / 취급고" formula would include 용역 too — mirror that here
  // so the totals cross-check stays consistent and isolates the behavior
  // under test (the excludeFromBillTotal flip) from an unrelated failure.
  const totalActBIdx = rows.findIndex((r) => (r[2] || '').trim() === '매출Total'.replace('Total', ' Total') && (r[3] || '').trim() === '취급고');
  assert.ok(totalActBIdx >= 0);
  rows[totalActBIdx] = rows[totalActBIdx].slice();
  for (let i = 4; i <= 15; i++) {
    const total = Number(rows[totalActBIdx][i].replace(/,/g, ''));
    const own = Number(rows[idx][i].replace(/,/g, ''));
    rows[totalActBIdx][i] = String(total + own);
  }
  const result = parseSheet(rows);
  assert.equal(result.products['용역'].excludeFromBillTotal, false);
});

test('missing the totals section header throws SheetStructureError and does not silently continue', () => {
  const rows = clone(FIXTURE);
  const idx = findRow(rows, 'KPI', 'Total');
  assert.ok(idx >= 0);
  rows[idx][2] = '뭔가 다른 라벨';
  assert.throws(() => parseSheet(rows), SheetStructureError);
});

test('missing the product-section header throws SheetStructureError', () => {
  const rows = clone(FIXTURE);
  const idx = rows.findIndex((r) => (r[2] || '').trim() === '미디어사업실 상품별 KPI 분석');
  assert.ok(idx >= 0);
  rows[idx][2] = '섹션 제목이 바뀜';
  assert.throws(() => parseSheet(rows), SheetStructureError);
});

test('a garbled metric-row order for a known product throws SheetStructureError instead of silently mis-mapping values', () => {
  const rows = clone(FIXTURE);
  // 비즈링 detail block: [취급고, KPI달성률(%), 매출, KPI달성률(%)] — swap rows 2 and 3
  const startIdx = rows.findIndex((r) => (r[2] || '').trim() === '비즈링' && (r[3] || '').trim() === '취급고');
  assert.ok(startIdx >= 0);
  const tmp = rows[startIdx + 1];
  rows[startIdx + 1] = rows[startIdx + 2];
  rows[startIdx + 2] = tmp;
  assert.throws(() => parseSheet(rows), SheetStructureError);
});

test('a non-numeric cell in a data row throws SheetStructureError', () => {
  const rows = clone(FIXTURE);
  const idx = findRow(rows, '', '취급고');
  assert.ok(idx >= 0);
  rows[idx] = rows[idx].slice();
  rows[idx][4] = 'N/A'; // Jan column corrupted
  assert.throws(() => parseSheet(rows), SheetStructureError);
});

test('an unrecognized new product row is included with a warning instead of being dropped or throwing', () => {
  const rows = clone(FIXTURE);
  // Insert a brand-new product block right after 비즈링's block, mirroring its shape.
  const bizIdx = rows.findIndex((r) => (r[2] || '').trim() === '비즈링' && (r[3] || '').trim() === '취급고');
  const insertAt = bizIdx + 4; // after 비즈링's 4-row block
  const mk = (c, d) => {
    const row = new Array(19).fill('');
    row[2] = c; row[3] = d;
    for (let i = 4; i <= 15; i++) row[i] = '0';
    row[16] = '0'; row[17] = '0'; row[18] = '0';
    return row;
  };
  const newBlock = [mk('신규상품', '취급고'), mk('', 'KPI달성률(%)'), mk('', '매출'), mk('', 'KPI달성률(%)')];
  rows.splice(insertAt, 0, ...newBlock);
  const result = parseSheet(rows);
  assert.ok(result.warnings.some((w) => w.includes('신규상품')));
  assert.ok(result.products['신규상품']);
  assert.equal(result.products['신규상품'].team, null);
});

test('a product-total mismatch beyond tolerance throws SheetStructureError (catches a silently dropped row)', () => {
  const rows = clone(FIXTURE);
  // Remove ASUM's whole detail block (4 rows) so the sum-of-products no
  // longer matches the sheet's own total row — must be caught, not ignored.
  const asumIdx = rows.findIndex((r) => (r[2] || '').trim() === 'ASUM' && (r[3] || '').trim() === '취급고');
  assert.ok(asumIdx >= 0);
  rows.splice(asumIdx, 4);
  assert.throws(() => parseSheet(rows), SheetStructureError);
});
