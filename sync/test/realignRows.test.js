'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { realignRows } = require('../sync');

test('leaves rows untouched when the KPI/Total anchor is already at COL.C/COL.D', () => {
  const rows = [
    ['4', '', '미디어사업실 KPI 분석', '', '1월'],
    ['5', '', 'KPI', 'Total', '621,491,667']
  ];
  assert.deepEqual(realignRows(rows), rows);
});

test('pads a missing leading column when the anchor is shifted one left', () => {
  const rows = [
    ['', '미디어사업실 KPI 분석', '', '1월'],
    ['', 'KPI', 'Total', '621,491,667']
  ];
  assert.deepEqual(realignRows(rows), [
    ['', '', '미디어사업실 KPI 분석', '', '1월'],
    ['', '', 'KPI', 'Total', '621,491,667']
  ]);
});

test('leaves rows untouched when neither anchor shape is found (lets parseSheet report the real error)', () => {
  const rows = [['completely', 'unrelated', 'content']];
  assert.deepEqual(realignRows(rows), rows);
});
