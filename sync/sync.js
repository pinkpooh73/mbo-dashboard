'use strict';
// Phase 2 sync job: Google Sheet -> data.json.
//
// Auth: a service-account JSON key, never committed — see README notes below
// and the report given to the user. Expected env vars:
//   GOOGLE_SERVICE_ACCOUNT_JSON  - the full service-account key JSON (string)
//   GOOGLE_SHEET_ID              - the target spreadsheet's ID
// Both come from GitHub Actions secrets in CI (see ../.github/workflows/sync.yml)
// and from a local .env-style export when run by hand; never hardcode them.
//
// Safety property this script guarantees: data.json is only written after
// parseSheet() has fully validated the fetched rows. Any structural problem
// (missing section, garbled row order, non-numeric cell, sheet-vs-product
// total mismatch) throws before any write happens, so a bad sync leaves the
// previous data.json exactly as it was.

const fs = require('fs');
const path = require('path');
const { GoogleAuth } = require('google-auth-library');
const { parseSheet, SheetStructureError, padRow } = require('./parseSheet');
const { renderRawTable } = require('./renderRawTable');
const { appendSnapshot } = require('./mergeSnapshot');
const { detectAnomalies } = require('./detectAnomalies');
const { notifyAnomalies } = require('./notify');

const SHEET_NAME = '미디어사업실_전체';
const RANGE = `${SHEET_NAME}!A1:S120`;
const DATA_JSON_PATH = path.join(__dirname, '..', 'data.json');

function ghWarning(msg) {
  console.log(`::warning::${msg}`);
}
function ghError(msg) {
  console.log(`::error::${msg}`);
}

async function fetchSheetRows() {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!keyJson) throw new Error('환경변수 GOOGLE_SERVICE_ACCOUNT_JSON이 설정되지 않았습니다.');
  if (!sheetId) throw new Error('환경변수 GOOGLE_SHEET_ID가 설정되지 않았습니다.');

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

  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}` +
    `/values/${encodeURIComponent(RANGE)}?valueRenderOption=FORMATTED_VALUE`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken.token}` } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Google Sheets API 호출 실패 (HTTP ${res.status}): ${body.slice(0, 500)}`);
  }
  const json = await res.json();
  const rows = json.values || [];
  if (rows.length === 0) {
    throw new Error('시트에서 값을 하나도 읽지 못했습니다 (시트 이름/범위/서비스 계정 공유 권한을 확인하세요).');
  }
  return rows;
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

  const updated = Object.assign({}, existing, {
    updatedAt: new Date().toISOString(),
    products: result.products,
    quarterlyOverall: {
      kpiWon: result.totalsCheck.totals.totalKpiR,
      actWon: result.totalsCheck.totals.totalActR
    },
    rawTableHtml: renderRawTable(rows.map(padRow)),
    dataQualityWarnings: result.warnings,
    dataQualityAnomalies: anomalies,
    snapshotHistory: newSnapshotHistory
  });
  // Phase 4: WEEKCMP/WEEKPROD ("주차별 비교") are now derived client-side
  // from the two most recent snapshotHistory entries (see
  // computeWeeklyComparison/computeWeeklyProductChanges in index.html) —
  // the sync job no longer owns or writes these fields.
  delete updated.weeklyComparison;
  delete updated.weeklyProductChanges;

  fs.writeFileSync(DATA_JSON_PATH, JSON.stringify(updated), 'utf8');
  console.log(
    `data.json 갱신 완료 (products: ${Object.keys(result.products).length}, ` +
    `warnings: ${result.warnings.length}, anomalies: ${anomalies.length}, ` +
    `snapshotHistory: ${newSnapshotHistory.length}개)`
  );

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

main().catch((e) => {
  ghError('예상치 못한 오류로 중단되었습니다: ' + ((e && e.stack) || e));
  process.exitCode = 1;
});
