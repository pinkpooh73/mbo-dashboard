'use strict';
// Loads product metadata (name normalization + team assignment) from
// productConfig.json — see that file for what to edit when a new product
// shows up on the sheet (business-rules.md has the full walkthrough).
//
// The sheet and the dashboard have historically used different spellings for
// the same product (e.g. sheet "스텔라이즈" vs dashboard "Stellaize", sheet
// "용역사업(sk광고+커머스렙)" vs dashboard "용역"). productConfig.json is the
// single place that reconciles that drift — do not special-case product
// names anywhere else in the sync pipeline.
//
// Entries are matched with whitespace stripped (also used elsewhere in
// parseSheet.js for label comparisons).

const productConfig = require('./productConfig.json');

function stripWs(s) {
  return String(s).replace(/\s+/g, '');
}

const RAW_MAP = productConfig.products;
const BY_STRIPPED_NAME = new Map(RAW_MAP.map((e) => [stripWs(e.sheetLabel), e]));

// Exclusion is always driven by the live "(인식x)" marker text on the sheet
// itself (see parseSheet.js) — never by a hardcoded product-name list. This
// is kept only as a reference/sanity-check list for tests.
const KNOWN_EXCLUDED_FROM_BILL = ['용역', '다윈'];

function resolveProduct(sheetLabel) {
  return BY_STRIPPED_NAME.get(stripWs(sheetLabel)) || null;
}

module.exports = { resolveProduct, stripWs, KNOWN_EXCLUDED_FROM_BILL, RAW_MAP };
