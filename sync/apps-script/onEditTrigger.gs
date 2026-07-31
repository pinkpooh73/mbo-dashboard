/**
 * Google Apps Script — bind this to "2026년_미디어사업실 매출 관리_v2.0".
 *
 * What it does: whenever the "미디어사업실_전체" sheet tab is edited, it waits
 * a short debounce window (in case more edits are coming), then sends a
 * `repository_dispatch` event to GitHub, which the sync.yml workflow listens
 * for and reacts to immediately — instead of waiting for the next hourly
 * cron tick. See CLAUDE.md / the chat report for the full setup walkthrough;
 * this file is the code to paste in, not a replacement for those steps.
 *
 * Required Script Properties (Project Settings > Script Properties, NOT
 * hardcoded here — a GitHub token in source would be readable by anyone who
 * can view this Apps Script project):
 *   GITHUB_TOKEN - a fine-grained PAT scoped to just this repo, "Contents"
 *                  read/write permission is enough (that's what triggers
 *                  repository_dispatch); see setup steps for exactly how to
 *                  mint one.
 *   GITHUB_REPO  - "pinkpooh73/mbo-dashboard"
 */

var TARGET_SHEET_NAME = '미디어사업실_전체';
var DEBOUNCE_SECONDS = 30;
var DEBOUNCE_HANDLER = 'debouncedDispatch';

/**
 * Installable trigger target — set this up via Triggers > Add Trigger >
 * choose function "onSheetEdit" > event source "From spreadsheet" > event
 * type "On edit". (Do NOT rely on the simple/reserved `onEdit(e)` name for
 * this — a simple trigger cannot call UrlFetchApp, which is why an
 * installable trigger pointing at a differently-named function is required.)
 */
function onSheetEdit(e) {
  try {
    if (!e || !e.range) return;
    var sheet = e.range.getSheet();
    if (sheet.getName() !== TARGET_SHEET_NAME) return; // ignore edits elsewhere in the workbook
    scheduleDebouncedDispatch();
  } catch (err) {
    console.error('onSheetEdit failed: ' + err);
  }
}

/**
 * Coalesces a burst of edits (e.g. someone typing across several cells) into
 * exactly one dispatch, fired DEBOUNCE_SECONDS after the most recent edit —
 * without this, saving a row of 12 monthly values would fire 12 syncs.
 */
function scheduleDebouncedDispatch() {
  removeDebounceTriggers();
  ScriptApp.newTrigger(DEBOUNCE_HANDLER)
    .timeBased()
    .after(DEBOUNCE_SECONDS * 1000)
    .create();
}

function debouncedDispatch() {
  removeDebounceTriggers();
  dispatchSync();
}

function removeDebounceTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === DEBOUNCE_HANDLER) ScriptApp.deleteTrigger(t);
  });
}

function dispatchSync() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('GITHUB_TOKEN');
  var repo = props.getProperty('GITHUB_REPO');
  if (!token || !repo) {
    console.error('GITHUB_TOKEN / GITHUB_REPO Script Properties are not set — see file header comment.');
    return;
  }
  var url = 'https://api.github.com/repos/' + repo + '/dispatches';
  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json'
    },
    payload: JSON.stringify({ event_type: 'sheet-edited' }),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code >= 200 && code < 300) {
    console.log('dispatch sent OK (HTTP ' + code + ')');
  } else {
    console.error('dispatch failed: HTTP ' + code + ' — ' + res.getContentText());
  }
}

/**
 * Run this manually from the Apps Script editor (select function
 * "testDispatch" in the toolbar dropdown, then Run) to verify the
 * GITHUB_TOKEN/GITHUB_REPO wiring works BEFORE trusting the onEdit trigger —
 * check the GitHub repo's Actions tab for a new "Sync data.json" run
 * immediately after running this.
 */
function testDispatch() {
  dispatchSync();
}
