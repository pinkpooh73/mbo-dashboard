'use strict';
// Regenerates the "KPI 데이터" tab's raw sheet view from freshly fetched rows,
// replacing what used to be a static, easily-stale HTML blob (see PRD §1.1 —
// "KPI 데이터 원본 뷰 탭은 별도의 정적 HTML 문자열로 재생성 필요, 누락되기 쉬움").
// This is a deliberate visual simplification vs. the original pixel-tuned
// static export: it reuses index.html's existing `table`/`thead`/`td` CSS
// instead of per-cell inline styles, so it inherits the pastel design system
// automatically instead of needing manual re-styling every sync.

const { COL } = require('./parseSheet');

function rateColor(pct) {
  if (pct >= 100) return '#4FB88A';
  if (pct >= 70) return '#E3A857';
  if (pct > 0) return '#E2685C';
  return '#A6ACBD';
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtCell(raw, isRate) {
  const s = (raw || '').toString().trim();
  if (s === '') return '-';
  if (isRate) {
    const n = Number(s.replace(/%$/, ''));
    if (!Number.isNaN(n)) {
      return `<span style="color:${rateColor(n)};font-weight:600;">${esc(s)}</span>`;
    }
  }
  return esc(s);
}

/**
 * @param {string[][]} rows - the same padded rows parseSheet() consumed.
 * @returns {string} HTML for #raw-wrap's innerHTML.
 */
function renderRawTable(rows) {
  const header = ['행', '구분', '지표', ...Array.from({ length: 12 }, (_, i) => `${i + 1}월`),
    '상반기 합계', '하반기 합계', '연간 합계'];
  let html = '<table><thead><tr>' +
    header.map((h) => `<th>${esc(h)}</th>`).join('') +
    '</tr></thead><tbody>';

  for (const row of rows) {
    const rownum = (row[COL.ROWNUM] || '').trim();
    const c = (row[COL.C] || '').trim();
    const d = (row[COL.D] || '').trim();
    if (c === '' && d === '') continue; // fully blank spacer row
    // The sheet's own column-reference row ("행"/"A"/"C"/"1월".."12월" as
    // literal text, not data) used to be excludable by checking rownum was
    // non-numeric — but rownum went from a real row-number helper (as of the
    // 2026-07-31 fixture) to genuinely empty in the live sheet, which made
    // *every* row fail that check and left the whole table empty (caught
    // 2026-08-10). "1월" as literal text in the Jan column is unique to this
    // one header row; no real data row ever puts text there instead of a number.
    if ((row[COL.JAN] || '').trim() === '1월') continue;
    const isRateRow = d.replace(/\s+/g, '') === 'KPI달성률(%)';
    const cells = [];
    for (let i = COL.JAN; i <= COL.ANN; i++) cells.push(fmtCell(row[i], isRateRow));
    html += '<tr>' +
      `<td style="color:var(--tm);font-family:'DM Mono',monospace;">${esc(rownum || '-')}</td>` +
      `<td style="font-weight:600;">${esc(c)}</td>` +
      `<td style="color:var(--ts);">${esc(d)}</td>` +
      cells.map((v) => `<td>${v}</td>`).join('') +
      '</tr>';
  }
  html += '</tbody></table>';
  return html;
}

module.exports = { renderRawTable };
