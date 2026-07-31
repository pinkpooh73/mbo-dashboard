'use strict';
// Offline dry-run of the sync pipeline's parse+merge+write logic, using the
// real 2026-07-31 fixture instead of a live Google Sheets fetch (no network,
// no credentials needed). Writes to a scratch copy of data.json, never the
// real one — this is a local sanity check, not part of `npm test`.
const fs = require('fs');
const path = require('path');
const { parseSheet, padRow } = require('../parseSheet');
const { renderRawTable } = require('../renderRawTable');

const rows = require('../test/fixtures/sheet_20260731.json');
const existingPath = path.join(__dirname, '..', '..', 'data.json');
const outPath = path.join(__dirname, 'dryRun.out.json');

const result = parseSheet(rows);
const existing = JSON.parse(fs.readFileSync(existingPath, 'utf8'));

const updated = Object.assign({}, existing, {
  updatedAt: new Date().toISOString(),
  products: result.products,
  quarterlyOverall: {
    kpiWon: result.totalsCheck.totals.totalKpiR,
    actWon: result.totalsCheck.totals.totalActR
  },
  rawTableHtml: renderRawTable(rows.map(padRow)),
  dataQualityWarnings: result.warnings
});

fs.writeFileSync(outPath, JSON.stringify(updated), 'utf8');
console.log('wrote', outPath, JSON.stringify(updated).length, 'bytes');
console.log('warnings:', result.warnings);
console.log('unchanged fields carried over:',
  ['agencyRevenue', 'campaignDetails', 'weeklyComparison', 'weeklyProductChanges',
    'snapshotHistory', 'legacy', 'stellaH1BillOverride', 'monthsElapsed']
    .map((k) => `${k}=${JSON.stringify(updated[k]) === JSON.stringify(existing[k])}`)
    .join(', '));
