'use strict';
// Maps a sheet-side product label (whitespace-insensitive) to the canonical
// product key used in data.json / index.html, plus its team assignment.
//
// The sheet and the dashboard have historically used different spellings for
// the same product (e.g. sheet "스텔라이즈" vs dashboard "Stellaize", sheet
// "용역사업(sk광고+커머스렙)" vs dashboard "용역"). This table is the single
// place that reconciles that drift — do not special-case product names
// anywhere else in the sync pipeline.
//
// Keys are matched with whitespace stripped (see normalizeLabel in parseSheet.js).

function stripWs(s) {
  return String(s).replace(/\s+/g, '');
}

const RAW_MAP = [
  { sheetName: '비즈링', key: '비즈링', team: 'biz' },
  { sheetName: '들리고', key: '들리고', team: 'biz' },
  { sheetName: '문자&B2G', key: '문자B2G', team: 'biz' },
  { sheetName: '옥외광고', key: '옥외광고', team: 'biz' },
  { sheetName: '용역사업(sk광고+커머스렙)', key: '용역', team: 'biz' },
  // KPI-target summary block uses the short form "용역사업(매출)" while the
  // actuals detail block uses the fuller "용역사업(sk광고+커머스렙)" label —
  // both must resolve to the same canonical key.
  { sheetName: '용역사업', key: '용역', team: 'biz' },
  { sheetName: '다윈', key: '다윈', team: 'mkt' },
  { sheetName: 'ASUM', key: 'ASUM', team: 'mkt' },
  { sheetName: '비즈챗', key: '비즈챗', team: 'mkt' },
  { sheetName: '스텔라이즈', key: 'Stellaize', team: 'mkt' },
  { sheetName: 'RMN', key: 'RMN', team: 'mkt' },
  { sheetName: '기타', key: '기타', team: 'mkt' },
  { sheetName: '리사이즈애드', key: '리사이즈애드', team: 'mkt' }
];

const BY_STRIPPED_NAME = new Map(RAW_MAP.map((e) => [stripWs(e.sheetName), e]));

// Products whose "취급고" row is expected to carry the "(인식x)" suffix.
// Kept here only as a sanity-check list for tests; the actual exclusion flag
// always comes from the live "(인식x)" marker text on the sheet, never from
// this list, so a newly-flagged product is picked up automatically.
const KNOWN_EXCLUDED_FROM_BILL = ['용역', '다윈'];

function resolveProduct(sheetLabel) {
  return BY_STRIPPED_NAME.get(stripWs(sheetLabel)) || null;
}

module.exports = { resolveProduct, stripWs, KNOWN_EXCLUDED_FROM_BILL, RAW_MAP };
