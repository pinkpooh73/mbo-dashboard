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

// Builds a 4-row product block ([취급고, KPI달성률(%), 매출, KPI달성률(%)])
// with the given monthly 취급고/매출 figures, and splices it in after 비즈링.
function withExtraProduct(rows, name, actB, actR) {
  const bizIdx = rows.findIndex((r) => (r[2] || '').trim() === '비즈링' && (r[3] || '').trim() === '취급고');
  assert.ok(bizIdx >= 0);
  const mk = (c, d, monthly) => {
    const row = new Array(19).fill('');
    row[2] = c; row[3] = d;
    for (let i = 4; i <= 15; i++) row[i] = String(monthly);
    row[16] = '0'; row[17] = '0'; row[18] = '0';
    return row;
  };
  const block = [
    mk(name, '취급고', actB),
    mk('', 'KPI달성률(%)', 0),
    mk('', '매출', actR),
    mk('', 'KPI달성률(%)', 0)
  ];
  rows.splice(bizIdx + 4, 0, ...block); // after 비즈링's own 4-row block
  return rows;
}

test('an unrecognized new product row is included with a warning instead of being dropped or throwing', () => {
  const rows = withExtraProduct(clone(FIXTURE), '신규상품', 0, 0);
  const result = parseSheet(rows);
  assert.ok(result.warnings.some((w) => w.includes('신규상품')));
  assert.ok(result.products['신규상품']);
  assert.equal(result.products['신규상품'].team, null);
});

// T-2: the "silently team:null + warning" path is the documented contract for
// a product that exists in the sheet but not in productConfig.json
// (business-rules.md §3). Pin down the parts a human actually depends on:
// the warning names the product AND the config file to edit, the product's
// real figures survive into products (not zeroed, not dropped), and products
// that ARE in productConfig.json still get their team.
test('a product missing from productConfig.json warns by name, points at the config file, and keeps its figures', () => {
  const productConfig = require('../productConfig.json');
  const configured = new Set(productConfig.products.map((p) => p.sheetLabel));
  assert.ok(!configured.has('미등록신상품'), 'test fixture name must not be in the real config');

  const rows = withExtraProduct(clone(FIXTURE), '미등록신상품', 5000000, 3000000);
  // The sheet's own total rows would include this product in reality; mirror
  // that so the cross-check stays consistent and only the mapping is tested.
  const bumpTotals = (colC, colD, perMonth) => {
    const idx = rows.findIndex((r) => (r[2] || '').trim() === colC && (r[3] || '').trim() === colD);
    assert.ok(idx >= 0, `총계 행을 찾지 못함: ${colC}/${colD}`);
    rows[idx] = rows[idx].slice();
    for (let i = 4; i <= 15; i++) {
      rows[idx][i] = String(Number(rows[idx][i].replace(/,/g, '')) + perMonth);
    }
  };
  bumpTotals('매출 Total', '취급고', 5000000);
  const actRIdx = rows.findIndex((r) => (r[2] || '').trim() === '매출 Total' && (r[3] || '').trim() === '취급고') + 2;
  rows[actRIdx] = rows[actRIdx].slice();
  for (let i = 4; i <= 15; i++) {
    rows[actRIdx][i] = String(Number(rows[actRIdx][i].replace(/,/g, '')) + 3000000);
  }

  const result = parseSheet(rows);

  const warning = result.warnings.find((w) => w.includes('미등록신상품'));
  assert.ok(warning, '미등록 상품에 대한 경고가 있어야 한다');
  assert.match(warning, /productConfig\.json/, '경고가 어떤 파일을 고쳐야 하는지 알려줘야 한다');

  const p = result.products['미등록신상품'];
  assert.ok(p, '미등록 상품이라도 파싱 결과에서 빠지면 안 된다');
  assert.equal(p.team, null, 'team은 null (팀 탭에는 안 뜨지만 전체 합계에는 포함)');
  assert.deepEqual(p.act_b, new Array(12).fill(500), '실적이 0으로 뭉개지지 않고 만원 단위로 살아있어야 한다');
  assert.deepEqual(p.act_r, new Array(12).fill(300));
  assert.equal(p.excludeFromBillTotal, false);
  // Known products are unaffected by the presence of an unmapped one.
  assert.equal(result.products['비즈링'].team, 'biz');
  // Only the unmapped product warns — no collateral noise.
  assert.equal(result.warnings.length, 1, result.warnings.join(' | '));
});

// ---- E-3: truncated sheets must fail as SheetStructureError with a message
// that names the missing row, not as a bare TypeError from cell(undefined). ----

test('a sheet truncated right after "KPI/Total" throws SheetStructureError, not a TypeError', () => {
  const rows = clone(FIXTURE);
  const idx = findRow(rows, 'KPI', 'Total');
  assert.ok(idx >= 0);
  const truncated = rows.slice(0, idx + 1); // the 취급고/매출 rows below it are gone
  assert.throws(() => parseSheet(truncated), (err) => {
    assert.ok(err instanceof SheetStructureError, `expected SheetStructureError, got ${err.name}: ${err.message}`);
    assert.match(err.message, /취급고/);
    assert.match(err.message, /행/);
    return true;
  });
});

test('a sheet truncated right after the "매출 Total / 취급고" header throws SheetStructureError', () => {
  const rows = clone(FIXTURE);
  const idx = rows.findIndex((r) => (r[2] || '').trim() === '매출 Total' && (r[3] || '').trim() === '취급고');
  assert.ok(idx >= 0);
  const truncated = rows.slice(0, idx + 2); // its "매출" row two below is gone
  assert.throws(() => parseSheet(truncated), (err) => {
    assert.ok(err instanceof SheetStructureError, `expected SheetStructureError, got ${err.name}: ${err.message}`);
    assert.match(err.message, /매출/);
    return true;
  });
});

test('a sheet truncated right after the product-section header throws SheetStructureError', () => {
  const rows = clone(FIXTURE);
  const idx = rows.findIndex((r) => (r[2] || '').trim() === '미디어사업실 상품별 KPI 분석');
  assert.ok(idx >= 0);
  const truncated = rows.slice(0, idx + 1);
  assert.throws(() => parseSheet(truncated), (err) => {
    assert.ok(err instanceof SheetStructureError, `expected SheetStructureError, got ${err.name}: ${err.message}`);
    assert.match(err.message, /상품별 KPI 분석/);
    return true;
  });
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
