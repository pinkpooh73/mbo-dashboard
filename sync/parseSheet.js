'use strict';
const { resolveProduct, stripWs } = require('./nameAliases');

class SheetStructureError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SheetStructureError';
  }
}

// Column layout of the "미디어사업실_전체" sheet (A1 notation), fixed since
// Phase 1 (confirmed against the live sheet export on 2026-07-31):
//   A = row number, B = (spacer, always blank), C = section/product label,
//   D = metric label, E:P = Jan..Dec (12 cols), Q = H1 total, R = H2 total,
//   S = annual total, T = (unused trailing column).
const COL = { ROWNUM: 0, C: 2, D: 3, JAN: 4, H1: 16, H2: 17, ANN: 18 };
const MONTHS = 12;

function padRow(row) {
  const r = row.slice();
  while (r.length <= COL.ANN) r.push('');
  return r;
}

function cell(row, idx) {
  return (row[idx] || '').toString().trim();
}

function parseNumber(str, ctx) {
  const s = (str || '').toString().trim();
  if (s === '' || s === '-') return 0;
  const cleaned = s.replace(/,/g, '').replace(/%$/, '');
  const n = Number(cleaned);
  if (Number.isNaN(n)) {
    throw new SheetStructureError(
      `숫자로 해석할 수 없는 값입니다: "${str}" (${ctx})`
    );
  }
  return n;
}

function readMonthly(row, ctx) {
  const out = [];
  for (let i = 0; i < MONTHS; i++) {
    out.push(parseNumber(row[COL.JAN + i], ctx + ` ${i + 1}월`));
  }
  return out;
}

function labelEq(row, colIdx, expected) {
  return stripWs(cell(row, colIdx)) === stripWs(expected);
}

// Anchor-relative row access (`rows[anchorIdx + 1]` and friends) is how every
// block in this sheet is read. If the sheet is truncated — a shortened fetch
// range, a deleted trailing block, an export that stops early — that index is
// simply `undefined` and the *next* cell() call blows up with a bare TypeError
// ("예상치 못한 오류로 중단되었습니다"), which tells the person on call
// nothing. Every out-of-range access must instead surface as a
// SheetStructureError naming the row we expected and why, exactly like the
// label-mismatch errors below.
function requireRow(rows, idx, ctx) {
  const row = rows[idx];
  if (!row) {
    throw new SheetStructureError(
      `${ctx}에 해당하는 행(시트 ${idx + 1}번째 행)이 없습니다 — 시트가 예상보다 일찍 끝났거나 ` +
      `해당 블록이 통째로 삭제/이동된 것으로 보입니다 (읽어온 행 수: ${rows.length}).`
    );
  }
  return row;
}

// ---- totals block (rows ~5-11): used only as a cross-check, never written
// directly into data.json (Phase 1 already made the frontend compute totals
// from `products` at runtime) ----
function parseTotalsBlock(rows) {
  const scanLimit = Math.min(rows.length, 20);
  let kpiTotalIdx = -1;
  for (let i = 0; i < scanLimit; i++) {
    if (labelEq(rows[i], COL.C, 'KPI') && labelEq(rows[i], COL.D, 'Total')) {
      kpiTotalIdx = i;
      break;
    }
  }
  if (kpiTotalIdx === -1) {
    throw new SheetStructureError(
      '총계 블록의 "KPI / Total" 헤더 행을 찾지 못했습니다 (시트 상단 구조 변경 의심).'
    );
  }
  const kpiBRow = requireRow(rows, kpiTotalIdx + 1, '총계 블록 "KPI/Total" 바로 다음의 "취급고"');
  const kpiRRow = requireRow(rows, kpiTotalIdx + 2, '총계 블록 "KPI/Total" 두 행 뒤의 "매출"');
  if (!labelEq(kpiBRow, COL.D, '취급고')) {
    throw new SheetStructureError(
      `"KPI/Total" 다음 행이 "취급고"가 아닙니다: "${cell(kpiBRow, COL.D)}"`
    );
  }
  if (!labelEq(kpiRRow, COL.D, '매출')) {
    throw new SheetStructureError(
      `총계 취급고 다음 행이 "매출"이 아닙니다: "${cell(kpiRRow, COL.D)}"`
    );
  }

  let actHeaderIdx = -1;
  for (let i = kpiTotalIdx + 3; i < scanLimit; i++) {
    if (labelEq(rows[i], COL.C, '매출Total') && labelEq(rows[i], COL.D, '취급고')) {
      actHeaderIdx = i;
      break;
    }
  }
  if (actHeaderIdx === -1) {
    throw new SheetStructureError(
      '총계 블록의 "매출 Total / 취급고" 헤더 행을 찾지 못했습니다.'
    );
  }
  const actBRow = requireRow(rows, actHeaderIdx, '총계 블록 "매출 Total / 취급고" 실적');
  const actRRow = requireRow(rows, actHeaderIdx + 2, '총계 블록 "매출 Total" 취급고 두 행 뒤의 "매출" 실적');
  if (!labelEq(actRRow, COL.D, '매출')) {
    throw new SheetStructureError(
      `총계 실적 취급고 두 행 뒤가 "매출"이 아닙니다: "${cell(actRRow, COL.D)}"`
    );
  }

  return {
    totalKpiB: readMonthly(kpiBRow, '총계 취급고 KPI'),
    totalKpiR: readMonthly(kpiRRow, '총계 매출 KPI'),
    totalActB: readMonthly(actBRow, '총계 취급고 실적'),
    totalActR: readMonthly(actRRow, '총계 매출 실적'),
    endIdx: actHeaderIdx + 4
  };
}

// ---- product KPI-target summary block: rows shaped "상품명(지표)" all in
// column D, column C blank. Ends at the first row that looks like the
// detail-block shape (non-blank C, D without a "(...)" suffix). ----
function parseKpiSummaryBlock(rows, startIdx) {
  const kpi = new Map(); // canonicalOrRaw -> {kpi_b, kpi_r}
  const warnings = [];
  let i = startIdx;
  for (; i < rows.length; i++) {
    const c = cell(rows[i], COL.C);
    const d = cell(rows[i], COL.D);
    if (c === '' && d === '') continue; // blank spacer row, keep scanning
    const m = d.match(/^(.+?)\(([^)]*)\)\s*$/);
    if (!m) break; // reached the detail block (or end of section)
    const rawName = m[1].trim();
    const metric = m[2].trim();
    const resolved = resolveProduct(rawName);
    const key = resolved ? resolved.key : rawName;
    if (!resolved) warnings.push(`KPI 요약 블록에 미등록 상품명: "${rawName}"`);
    if (!kpi.has(key)) kpi.set(key, { kpi_b: null, kpi_r: null });
    const entry = kpi.get(key);
    if (metric.startsWith('취급고')) entry.kpi_b = readMonthly(rows[i], `${rawName} KPI 취급고`);
    else if (metric.startsWith('매출')) entry.kpi_r = readMonthly(rows[i], `${rawName} KPI 매출`);
    else warnings.push(`KPI 요약 블록의 알 수 없는 지표: "${d}"`);
  }
  return { kpi, warnings, endIdx: i };
}

const ZERO12 = new Array(MONTHS).fill(0);

// ---- product actuals detail block: each product starts at a row with a
// non-blank column C, followed by 2-3 more rows (blank C) until the next
// product. Two accepted shapes per product — see file header comment in
// nameAliases.js for why exclusion is driven by the "(인식x)" text itself. ----
function parseDetailBlock(rows, startIdx) {
  const products = new Map();
  const warnings = [];
  let i = startIdx;
  while (i < rows.length) {
    const c = cell(rows[i], COL.C);
    if (c === '') { i++; continue; }
    const block = [rows[i]];
    let j = i + 1;
    while (j < rows.length && cell(rows[j], COL.C) === '' && cell(rows[j], COL.D) !== '') {
      block.push(rows[j]);
      j++;
    }
    const labels = block.map((r) => stripWs(cell(r, COL.D)));
    let act_b, act_r, bill, rev, excludeFromBillTotal;
    if (block.length === 4 && (labels[0] === '취급고' || labels[0] === '취급고(인식x)') &&
        labels[1] === 'KPI달성률(%)' && labels[2] === '매출' && labels[3] === 'KPI달성률(%)') {
      act_b = readMonthly(block[0], `${c} 취급고 실적`);
      bill = readMonthly(block[1], `${c} 취급고 달성률`);
      act_r = readMonthly(block[2], `${c} 매출 실적`);
      rev = readMonthly(block[3], `${c} 매출 달성률`);
      excludeFromBillTotal = labels[0] === '취급고(인식x)';
    } else if (block.length === 3 && (labels[0] === '취급고' || labels[0] === '취급고(인식x)') &&
               labels[1] === '매출' && labels[2] === 'KPI달성률(%)') {
      act_b = readMonthly(block[0], `${c} 취급고 실적`);
      act_r = readMonthly(block[1], `${c} 매출 실적`);
      rev = readMonthly(block[2], `${c} 매출 달성률`);
      bill = ZERO12.slice();
      excludeFromBillTotal = labels[0] === '취급고(인식x)';
    } else {
      throw new SheetStructureError(
        `"${c}" 상품 블록의 행 구조를 인식할 수 없습니다 (지표 순서: ${labels.join(' / ')}). ` +
        `기대 패턴: [취급고, KPI달성률(%), 매출, KPI달성률(%)] 또는 [취급고, 매출, KPI달성률(%)].`
      );
    }
    const resolved = resolveProduct(c);
    const key = resolved ? resolved.key : c;
    const team = resolved ? resolved.team : null;
    if (!resolved) warnings.push(`신규/미분류 상품 발견: "${c}" (team 미지정(null)으로 반영됨 — sync/productConfig.json에 매핑 추가 필요)`);
    products.set(key, { team, act_b, act_r, bill, rev, excludeFromBillTotal, sheetLabel: c });
    i = j;
  }
  return { products, warnings };
}

function sumMonthly(arrays) {
  const out = ZERO12.slice();
  for (const arr of arrays) for (let i = 0; i < MONTHS; i++) out[i] += arr[i];
  return out;
}

function maxAbsDiff(a, b) {
  let max = 0;
  for (let i = 0; i < MONTHS; i++) max = Math.max(max, Math.abs(a[i] - b[i]));
  return max;
}

const CROSS_CHECK_TOLERANCE_WON = 20000; // ~2만원/월, matches historical rounding seen in Phase 1

/**
 * @param {string[][]} rows - 2D array of cell text, starting at the sheet's
 *   row 1 (row[0] = header row containing "행"/"A"/... labels is OK to
 *   include or omit; the parser locates anchors by content, not position).
 * @returns {{products: Object, warnings: string[], totalsCheck: Object}}
 * @throws {SheetStructureError} on any structural mismatch. Callers MUST NOT
 *   write data.json when this throws — the previous file should be left
 *   untouched.
 */
function parseSheet(rawRows) {
  const rows = rawRows.map(padRow);
  const warnings = [];

  const totals = parseTotalsBlock(rows);

  let sectionIdx = -1;
  for (let i = totals.endIdx; i < rows.length; i++) {
    if (cell(rows[i], COL.C) === '미디어사업실 상품별 KPI 분석') { sectionIdx = i; break; }
  }
  if (sectionIdx === -1) {
    throw new SheetStructureError('"미디어사업실 상품별 KPI 분석" 섹션 헤더를 찾지 못했습니다.');
  }
  let summaryStart = sectionIdx + 1;
  const firstSummaryRow = requireRow(
    rows, summaryStart, '"미디어사업실 상품별 KPI 분석" 섹션 헤더 바로 다음 행'
  );
  if (labelEq(firstSummaryRow, COL.C, 'KPI') && labelEq(firstSummaryRow, COL.D, 'Total')) {
    summaryStart += 1; // skip the redundant repeated totals row
  }

  const summary = parseKpiSummaryBlock(rows, summaryStart);
  warnings.push(...summary.warnings);

  const detail = parseDetailBlock(rows, summary.endIdx);
  warnings.push(...detail.warnings);

  // Build a won-denominated view first — cross-checking against the sheet's
  // own total rows (also in won) must happen before any unit conversion.
  const wonProducts = {};
  for (const [key, d] of detail.products) {
    const kpi = summary.kpi.get(key) || { kpi_b: null, kpi_r: null };
    wonProducts[key] = {
      team: d.team,
      kpi_b: kpi.kpi_b || ZERO12.slice(),
      kpi_r: kpi.kpi_r || ZERO12.slice(),
      act_b: d.act_b,
      act_r: d.act_r,
      bill: d.bill,
      rev: d.rev,
      excludeFromBillTotal: d.excludeFromBillTotal
    };
  }
  for (const key of summary.kpi.keys()) {
    if (!wonProducts[key]) {
      throw new SheetStructureError(
        `"${key}"는 KPI 요약 블록에는 있지만 실적 상세 블록에 없습니다 (행 구조 누락 의심).`
      );
    }
  }

  const computedActB = sumMonthly(
    Object.values(wonProducts).filter((p) => !p.excludeFromBillTotal).map((p) => p.act_b)
  );
  const computedActR = sumMonthly(Object.values(wonProducts).map((p) => p.act_r));
  const computedKpiB = sumMonthly(Object.values(wonProducts).map((p) => p.kpi_b));
  const computedKpiR = sumMonthly(Object.values(wonProducts).map((p) => p.kpi_r));

  const diffs = {
    actB: maxAbsDiff(computedActB, totals.totalActB),
    actR: maxAbsDiff(computedActR, totals.totalActR),
    kpiB: maxAbsDiff(computedKpiB, totals.totalKpiB),
    kpiR: maxAbsDiff(computedKpiR, totals.totalKpiR)
  };
  for (const [label, diff] of Object.entries(diffs)) {
    if (diff > CROSS_CHECK_TOLERANCE_WON) {
      throw new SheetStructureError(
        `상품별 합계와 시트 총계 행이 어긋납니다 (${label}, 최대 차이 ${diff.toLocaleString()}원). ` +
        `상품 행이 누락됐거나 잘못 파싱됐을 가능성이 높습니다.`
      );
    }
  }

  // Only after validation passes: convert to 만원 (data.json's established
  // unit, see index.html/computeTotal) for the returned products. bill/rev
  // are already percentages and are carried over unchanged.
  const toManwon = (arr) => arr.map((v) => Math.round(v / 10000));
  const products = {};
  for (const [key, p] of Object.entries(wonProducts)) {
    products[key] = {
      team: p.team,
      kpi_b: toManwon(p.kpi_b),
      kpi_r: toManwon(p.kpi_r),
      act_b: toManwon(p.act_b),
      act_r: toManwon(p.act_r),
      bill: p.bill,
      rev: p.rev,
      excludeFromBillTotal: p.excludeFromBillTotal
    };
  }

  return {
    products,
    warnings,
    totalsCheck: { totals, computedActB, computedActR, computedKpiB, computedKpiR, diffs }
  };
}

module.exports = { parseSheet, SheetStructureError, parseNumber, readMonthly, padRow, COL };
