'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { renderRawTable } = require('../renderRawTable');
const { padRow, COL } = require('../parseSheet');

const FIXTURE = require('./fixtures/sheet_20260731.json');

function clone(rows) {
  return rows.map((r) => r.slice());
}

function rowCount(html) {
  return (html.match(/<tr>/g) || []).length;
}

test('renders data rows from the real 2026-07-31 export (column A still has row numbers)', () => {
  const html = renderRawTable(clone(FIXTURE).map(padRow));
  assert.ok(rowCount(html) > 50, `expected many rendered rows, got ${rowCount(html)}`);
});

test('still renders data rows when column A (row-number helper) is empty for every row', () => {
  // Reproduces the live sheet's 2026-08-10 state: column A went from a real
  // row-number helper to genuinely empty, which used to zero out every
  // rendered row because the old filter required a numeric row number.
  const blanked = clone(FIXTURE).map((r) => {
    const copy = r.slice();
    copy[COL.ROWNUM] = '';
    return copy;
  });
  const html = renderRawTable(blanked.map(padRow));
  assert.ok(rowCount(html) > 50, `expected many rendered rows even with blank column A, got ${rowCount(html)}`);
});

test('never renders the sheet\'s own column-reference header row ("1월".."12월" as literal text)', () => {
  const html = renderRawTable(clone(FIXTURE).map(padRow));
  assert.ok(!html.includes('>행<') || !html.match(/<td[^>]*>행<\/td>/), 'header row label leaked into a data cell');
  // The header row's distinguishing literal cell text should not appear as a rendered value.
  assert.doesNotMatch(html, /<td>1월<\/td>/);
});
