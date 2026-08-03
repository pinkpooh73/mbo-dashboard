'use strict';
// Decides whether a *scheduled* sync run should be skipped because today
// (Asia/Seoul) is a weekend or a Korean public holiday. Only ever consulted
// for `schedule`-triggered runs (see sync.yml) — the Apps Script webhook and
// manual workflow_dispatch always run regardless of the day.

const fs = require('fs');
const path = require('path');

const HOLIDAYS_PATH = path.join(__dirname, 'holidays.txt');

function loadHolidays(filePath) {
  const text = fs.readFileSync(filePath || HOLIDAYS_PATH, 'utf8');
  const dates = new Set();
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    dates.add(line);
  }
  return dates;
}

function seoulDateString(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
}

function seoulDayOfWeek(d) {
  // 0=Sun..6=Sat, computed in the Asia/Seoul calendar day (not UTC).
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', weekday: 'short' }).format(d);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts);
}

/**
 * @param {Date} now
 * @param {Set<string>} holidays - YYYY-MM-DD strings
 * @returns {{skip: boolean, reason: string|null, date: string}}
 */
function isSkipDay(now, holidays) {
  const date = seoulDateString(now);
  const dow = seoulDayOfWeek(now);
  if (dow === 0 || dow === 6) {
    return { skip: true, reason: '주말', date };
  }
  if (holidays.has(date)) {
    return { skip: true, reason: '공휴일', date };
  }
  return { skip: false, reason: null, date };
}

if (require.main === module) {
  const result = isSkipDay(new Date(), loadHolidays());
  if (result.skip) {
    console.error(`오늘(${result.date})은 ${result.reason}이라 예약 동기화를 건너뜁니다.`);
  }
  console.log(result.skip ? 'true' : 'false');
}

module.exports = { isSkipDay, loadHolidays, seoulDateString, seoulDayOfWeek };
