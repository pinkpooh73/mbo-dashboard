'use strict';
// Phase 2 sync job: Google Sheet -> data.json.
//
// Auth: this org's Cloud org policy (iam.disableServiceAccountKeyCreation)
// blocks service-account JSON key creation outright, so the primary path is
// a plain Sheets API key (GOOGLE_API_KEY) — which only works because the
// sheet itself is shared "anyone with the link can view"; an API key carries
// no identity, it just unlocks already-public data. The service-account path
// is kept as a fallback in case that org policy is ever lifted (e.g. via an
// exception or a Workload Identity Federation migration) — see
// business-rules.md §7. Expected env vars (at least one auth var required):
//   GOOGLE_API_KEY               - Sheets-API-restricted API key (preferred)
//   GOOGLE_SERVICE_ACCOUNT_JSON  - the full service-account key JSON (string), fallback
//   GOOGLE_SHEET_ID              - the target spreadsheet's ID (always required)
// All come from GitHub Actions secrets in CI (see ../.github/workflows/sync.yml)
// and from a local .env-style export when run by hand; never hardcode them.
//
// Safety property this script guarantees: data.json is only written after
// parseSheet() has fully validated the fetched rows. Any structural problem
// (missing section, garbled row order, non-numeric cell, sheet-vs-product
// total mismatch) throws before any write happens, so a bad sync leaves the
// previous data.json exactly as it was.
//
// SCOPE — this job only reads the "미디어사업실_전체" tab. It updates
// products / quarterlyOverall / dataQualityWarnings / dataQualityAnomalies /
// snapshotHistory / updatedAt and rewrites raw-table.html. It does NOT touch
// agencyRevenue, campaignDetails, legacy, stellaH1BillOverride or
// monthsElapsed — those live on other sheet tabs (or are Phase 1 leftovers)
// and are carried over verbatim, so they can be older than the header's
// "마지막 업데이트" timestamp suggests. See business-rules.md §7.
//
// Outputs are split in two: data.json (the data the dashboard computes from)
// and raw-table.html (the "KPI 데이터" tab's prerendered table, ~117KB —
// 78% of the old data.json — which the frontend only fetches when that tab
// is opened). Do not fold the HTML back into data.json.

const fs = require('fs');
const path = require('path');
const { GoogleAuth } = require('google-auth-library');
const { parseSheet, SheetStructureError, padRow } = require('./parseSheet');
const { renderRawTable } = require('./renderRawTable');
const { appendSnapshot } = require('./mergeSnapshot');
const { detectAnomalies } = require('./detectAnomalies');
const { detectChanges } = require('./detectChanges');
const { notifyAnomalies } = require('./notify');

const SHEET_NAME = '미디어사업실_전체';
const RANGE = `${SHEET_NAME}!A1:S120`;
const DATA_JSON_PATH = path.join(__dirname, '..', 'data.json');
const RAW_TABLE_PATH = path.join(__dirname, '..', 'raw-table.html');

function ghWarning(msg) {
  console.log(`::warning::${msg}`);
}
function ghError(msg) {
  console.log(`::error::${msg}`);
}

async function fetchSheetRows() {
  // CI/CD variable UIs (GitLab's Value textarea in particular) can smuggle in
  // a trailing newline/space on copy-paste, which Google's API rejects as
  // "API key not valid" even though the visible value looks identical —
  // confirmed live on GitLab 2026-08-13. trim() defensively so the same key
  // that works via GitHub Actions secrets works here too.
  const apiKey = (process.env.GOOGLE_API_KEY || '').trim() || undefined;
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const sheetId = (process.env.GOOGLE_SHEET_ID || '').trim();
  if (!sheetId) throw new Error('환경변수 GOOGLE_SHEET_ID가 설정되지 않았습니다.');
  if (!apiKey && !keyJson) {
    throw new Error('환경변수 GOOGLE_API_KEY 또는 GOOGLE_SERVICE_ACCOUNT_JSON 중 하나가 설정되어야 합니다.');
  }

  const baseUrl =
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}` +
    `/values/${encodeURIComponent(RANGE)}?valueRenderOption=FORMATTED_VALUE`;

  let res;
  if (apiKey) {
    // API 키 경로: 시트가 "링크 있는 모든 사용자에게 공개"로 공유되어 있어야
    // 동작한다 — 키 자체는 신원을 증명하지 않고 이미 공개된 데이터를 읽는
    // 호출량만 프로젝트 단위로 계량한다.
    res = await fetch(`${baseUrl}&key=${encodeURIComponent(apiKey)}`);
  } else {
    let credentials;
    try {
      credentials = JSON.parse(keyJson);
    } catch (e) {
      throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON을 JSON으로 파싱하지 못했습니다: ' + e.message);
    }
    const auth = new GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
    });
    const client = await auth.getClient();
    const accessToken = await client.getAccessToken();
    res = await fetch(baseUrl, { headers: { Authorization: `Bearer ${accessToken.token}` } });
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Google Sheets API 호출 실패 (HTTP ${res.status}): ${body.slice(0, 500)}`);
  }
  const json = await res.json();
  const rows = json.values || [];
  if (rows.length === 0) {
    throw new Error('시트에서 값을 하나도 읽지 못했습니다 (시트 이름/범위/공유 설정을 확인하세요).');
  }
  return realignRows(rows);
}

// The Sheets API (and the sheet's public CSV export, checked independently)
// both trim a fully-empty leading column A from the response — this sheet's
// column A held a row-number helper as of 2026-07-31 (see
// test/fixtures/sheet_20260731.json) but sits empty as of 2026-08-10, which
// shifts every row one column left of what parseSheet.js's fixed COL
// constants expect (confirmed live: a 2026-08-10 sync run failed to find the
// "KPI/Total" header because of exactly this). Detect which shape came back
// by checking where that anchor actually lands, rather than assuming either
// shape permanently — self-heals if column A ever gets repopulated again.
function realignRows(rows) {
  const scanLimit = Math.min(rows.length, 20);
  for (let i = 0; i < scanLimit; i++) {
    const row = rows[i] || [];
    const at = (idx) => (row[idx] || '').toString().trim();
    if (at(2) === 'KPI' && at(3) === 'Total') return rows;
    if (at(1) === 'KPI' && at(2) === 'Total') return rows.map((r) => [''].concat(r));
  }
  return rows; // neither anchor found — let parseSheet's own error surface
}

async function main() {
  let rows;
  try {
    rows = await fetchSheetRows();
  } catch (e) {
    ghError('시트를 읽어오지 못했습니다: ' + e.message);
    process.exitCode = 1;
    return;
  }

  let result;
  try {
    result = parseSheet(rows);
  } catch (e) {
    if (e instanceof SheetStructureError) {
      ghError('시트 구조 검증 실패 — data.json을 갱신하지 않습니다: ' + e.message);
      process.exitCode = 1;
      return;
    }
    throw e;
  }

  for (const w of result.warnings) ghWarning(w);

  const anomalies = detectAnomalies(result.products);
  for (const a of anomalies) ghWarning(`[이상치] ${a.detail}`);

  const existing = JSON.parse(fs.readFileSync(DATA_JSON_PATH, 'utf8'));

  const newSnapshotHistory = appendSnapshot(existing.snapshotHistory, result.products);
  const rawHtml = renderRawTable(rows.map(padRow));

  const candidate = Object.assign({}, existing, {
    products: result.products,
    quarterlyOverall: {
      kpiWon: result.totalsCheck.totals.totalKpiR,
      actWon: result.totalsCheck.totals.totalActR
    },
    dataQualityWarnings: result.warnings,
    dataQualityAnomalies: anomalies,
    snapshotHistory: newSnapshotHistory
  });
  // Phase 4: WEEKCMP/WEEKPROD ("주차별 비교") are now derived client-side
  // from the two most recent snapshotHistory entries (see
  // computeWeeklyComparison/computeWeeklyProductChanges in index.html) —
  // the sync job no longer owns or writes these fields.
  delete candidate.weeklyComparison;
  delete candidate.weeklyProductChanges;
  // The "KPI 데이터" tab's HTML now lives in raw-table.html, not in data.json.
  delete candidate.rawTableHtml;

  const existingRawHtml = fs.existsSync(RAW_TABLE_PATH)
    ? fs.readFileSync(RAW_TABLE_PATH, 'utf8')
    : null;
  const { changed, reasons } = detectChanges(existing, candidate, {
    existingRawHtml,
    newRawHtml: rawHtml
  });

  if (!changed) {
    // Nothing material moved: leave both files untouched (mtime included) so
    // sync.yml's `git diff --quiet` guard actually short-circuits and no
    // pointless commit/Pages redeploy happens. Anomaly notifications are
    // skipped too — an identical anomaly set was already reported by the run
    // that first produced it, and re-sending it every hour is just noise.
    console.log(
      `변경 없음 — data.json/raw-table.html을 쓰지 않고 종료합니다 ` +
      `(products: ${Object.keys(result.products).length}, anomalies: ${anomalies.length}).`
    );
    return;
  }

  candidate.updatedAt = new Date().toISOString();
  fs.writeFileSync(DATA_JSON_PATH, JSON.stringify(candidate), 'utf8');
  fs.writeFileSync(RAW_TABLE_PATH, rawHtml, 'utf8');
  console.log(
    `data.json/raw-table.html 갱신 완료 (products: ${Object.keys(result.products).length}, ` +
    `warnings: ${result.warnings.length}, anomalies: ${anomalies.length}, ` +
    `snapshotHistory: ${newSnapshotHistory.length}개)`
  );
  for (const r of reasons) console.log(`  변경 사유: ${r}`);

  // 이상치 알림은 data.json 갱신이 끝난 뒤에 시도한다 — 알림 전송이 실패하더라도
  // (예: Slack webhook 일시 장애) 이미 성공한 동기화 자체를 실패로 만들지 않기 위함.
  const sheetUrl = process.env.GOOGLE_SHEET_ID
    ? `https://docs.google.com/spreadsheets/d/${process.env.GOOGLE_SHEET_ID}/edit`
    : undefined;
  try {
    await notifyAnomalies(anomalies, { sheetUrl });
  } catch (e) {
    ghWarning('이상치 알림 전송 중 오류가 발생했지만 동기화 자체는 정상 완료된 상태입니다: ' + e.message);
  }
}

if (require.main === module) {
  main().catch((e) => {
    ghError('예상치 못한 오류로 중단되었습니다: ' + ((e && e.stack) || e));
    process.exitCode = 1;
  });
}

module.exports = { realignRows };
