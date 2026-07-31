'use strict';
// Offline dry-run of the sync pipeline's parse+merge+write logic, using the
// real 2026-07-31 fixture instead of a live Google Sheets fetch (no network,
// no credentials needed). Writes to scratch copies (dryRun.out.json +
// dryRun.out.raw-table.html), never the real data.json/raw-table.html — this
// is a local sanity check, not part of `npm test`.
const fs = require('fs');
const path = require('path');
const { parseSheet, padRow } = require('../parseSheet');
const { renderRawTable } = require('../renderRawTable');
const { appendSnapshot } = require('../mergeSnapshot');
const { detectAnomalies } = require('../detectAnomalies');
const { detectChanges } = require('../detectChanges');

const rows = require('../test/fixtures/sheet_20260731.json');
const existingPath = path.join(__dirname, '..', '..', 'data.json');
const existingRawPath = path.join(__dirname, '..', '..', 'raw-table.html');
const outPath = path.join(__dirname, 'dryRun.out.json');
const outRawPath = path.join(__dirname, 'dryRun.out.raw-table.html');

const result = parseSheet(rows);
const anomalies = detectAnomalies(result.products);
const existing = JSON.parse(fs.readFileSync(existingPath, 'utf8'));
const newSnapshotHistory = appendSnapshot(existing.snapshotHistory, result.products);
const rawHtml = renderRawTable(rows.map(padRow));

const updated = Object.assign({}, existing, {
  updatedAt: new Date().toISOString(),
  products: result.products,
  quarterlyOverall: {
    kpiWon: result.totalsCheck.totals.totalKpiR,
    actWon: result.totalsCheck.totals.totalActR
  },
  dataQualityWarnings: result.warnings,
  dataQualityAnomalies: anomalies,
  snapshotHistory: newSnapshotHistory
});
delete updated.weeklyComparison;
delete updated.weeklyProductChanges;
delete updated.rawTableHtml; // now a separate file, see below

// Same no-op detection the real sync uses — reported here, but the dry run
// writes its scratch output either way so you can always inspect it.
const existingRawHtml = fs.existsSync(existingRawPath)
  ? fs.readFileSync(existingRawPath, 'utf8')
  : null;
const change = detectChanges(existing, updated, { existingRawHtml, newRawHtml: rawHtml });

fs.writeFileSync(outPath, JSON.stringify(updated), 'utf8');
fs.writeFileSync(outRawPath, rawHtml, 'utf8');
console.log('wrote', outPath, JSON.stringify(updated).length, 'bytes');
console.log('wrote', outRawPath, rawHtml.length, 'bytes');
console.log('would write files?', change.changed, change.reasons);
console.log('warnings:', result.warnings);
console.log('anomalies:', anomalies.map((a) => a.detail));
console.log('snapshotHistory dates:', newSnapshotHistory.map((s) => s.date));
console.log('unchanged fields carried over:',
  ['agencyRevenue', 'campaignDetails', 'legacy', 'stellaH1BillOverride', 'monthsElapsed']
    .map((k) => `${k}=${JSON.stringify(updated[k]) === JSON.stringify(existing[k])}`)
    .join(', '));
