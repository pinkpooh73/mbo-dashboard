'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { isSkipDay, loadHolidays, seoulDateString, seoulDayOfWeek } = require('../isSkipDay');

const holidays = loadHolidays(path.join(__dirname, '..', 'holidays.txt'));

function kst(dateStr) {
  // Midday KST avoids any UTC-day-boundary ambiguity in the test itself.
  return new Date(dateStr + 'T12:00:00+09:00');
}

test('loads the real holidays.txt without choking on comments/blank lines', () => {
  assert.ok(holidays.size > 0);
  assert.ok(holidays.has('2026-01-01'), '신정 should be in the real list');
  assert.ok(!holidays.has('# 2026년 (출처: publicholidays.co.kr/ko/2026-dates, 2026-08 확인)'));
});

test('skips a Saturday', () => {
  const r = isSkipDay(kst('2026-08-15'), holidays); // 2026-08-15 is a Saturday
  assert.equal(r.skip, true);
  assert.equal(r.reason, '주말');
});

test('skips a Sunday', () => {
  const r = isSkipDay(kst('2026-08-16'), holidays); // Sunday
  assert.equal(r.skip, true);
  assert.equal(r.reason, '주말');
});

test('skips a weekday that is a known public holiday (설날, 2026-02-17 Tue)', () => {
  const r = isSkipDay(kst('2026-02-17'), holidays);
  assert.equal(r.skip, true);
  assert.equal(r.reason, '공휴일');
});

test('skips 제헌절 2026-07-17 (Fri) — reinstated as a holiday for 2026 specifically', () => {
  const r = isSkipDay(kst('2026-07-17'), holidays);
  assert.equal(r.skip, true);
  assert.equal(r.reason, '공휴일');
});

test('does NOT skip an ordinary weekday', () => {
  const r = isSkipDay(kst('2026-08-04'), holidays); // a Tuesday, not a holiday
  assert.equal(r.skip, false);
  assert.equal(r.reason, null);
});

test('does NOT skip the day right after a holiday run (regression guard against off-by-one)', () => {
  const r = isSkipDay(kst('2026-02-19'), holidays); // Thu, right after 설날 연휴
  assert.equal(r.skip, false);
});

test('seoulDayOfWeek is timezone-correct near the UTC/KST day boundary', () => {
  // 2026-08-16 00:30 KST = 2026-08-15 15:30 UTC — a naive UTC check would
  // read this as Saturday (6); it is actually Sunday (0) in Seoul.
  const justAfterMidnightKst = new Date('2026-08-15T15:30:00Z');
  assert.equal(seoulDateString(justAfterMidnightKst), '2026-08-16');
  assert.equal(seoulDayOfWeek(justAfterMidnightKst), 0);
});

test('an empty holiday set still correctly skips weekends', () => {
  const r = isSkipDay(kst('2026-08-15'), new Set());
  assert.equal(r.skip, true);
  assert.equal(r.reason, '주말');
});
