'use strict';
// 프론트엔드(index.html)가 쓰는 순수 계산 로직(../../compute.js)의 회귀 테스트.
// 화면 코드지만 계산 결과가 틀리면 그대로 잘못된 숫자가 보고되므로, sync 쪽
// 테스트와 같은 러너(`cd sync && npm test`)로 함께 돌린다.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../compute.js');

const Z12 = () => new Array(12).fill(0);
function product(overrides) {
  return Object.assign(
    { team: 'biz', kpi_b: Z12(), kpi_r: Z12(), act_b: Z12(), act_r: Z12(), bill: Z12(), rev: Z12(), excludeFromBillTotal: false },
    overrides
  );
}

// ─────────────────────────────────────────────────────────────
// F-1 회귀: 팀 탭 "상품별 실적 상세" 표는 기준월 N까지 합산해야 한다.
// (예전에는 slice(0,6)이 하드코딩돼 있어서 제목은 "1~7월"인데 숫자는 1~6월이었다)
// 아래 배열은 2026-07-31 시점 data.json의 문자B2G 실제 값이다.
// ─────────────────────────────────────────────────────────────
const MOONJA_B2G = product({
  kpi_b: [600, 600, 1400, 1400, 1400, 1400, 2100, 2100, 2100, 2100, 2100, 2100],
  act_b: [616, 202, 2222, 1692, 717, 824, 270, 648, 0, 0, 0, 0],
  kpi_r: [600, 600, 720, 720, 720, 720, 825, 825, 825, 825, 825, 825],
  act_r: [616, 202, 707, 772, 312, 374, 157, 648, 0, 0, 0, 0]
});

test('teamTableRows: 기준월 N=7이면 1~7월 기준으로 합산한다 (F-1 회귀)', () => {
  const [row] = C.teamTableRows({ '문자B2G': MOONJA_B2G }, 7);
  assert.equal(row.name, '문자B2G');
  assert.equal(row.kpi_b, 8900, '취급고 KPI 1~7월 합');
  assert.equal(row.act_b, 6543, '취급고 실적 1~7월 합');
  assert.equal(row.billRate, 73.5, '취급고 달성률 = 6543/8900');
  assert.equal(row.kpi_r, 4905);
  assert.equal(row.act_r, 3140);
  assert.equal(row.revRate, 64);
});

test('teamTableRows: N을 바꾸면 결과도 따라 바뀐다 (6이 박혀 있지 않다는 증거)', () => {
  const [six] = C.teamTableRows({ '문자B2G': MOONJA_B2G }, 6);
  // 버그 시절 화면에 뜨던 값 — 이제는 N=6을 명시적으로 넘겼을 때만 나온다.
  assert.equal(six.billRate, 92.3);
  const [seven] = C.teamTableRows({ '문자B2G': MOONJA_B2G }, 7);
  assert.notEqual(seven.billRate, six.billRate);
});

test('teamTableRows: KPI가 0이면 달성률은 0 (0으로 나누지 않는다)', () => {
  const [row] = C.teamTableRows({ '기타': product({ act_b: [0, 0, 0, 409, 264, 151, 0, 100, 0, 300, 0, 0] }) }, 7);
  assert.equal(row.billRate, 0);
  assert.equal(row.act_b, 824);
});

// ─────────────────────────────────────────────────────────────
// 취급고 총계 제외 규칙 (business-rules.md §2)
// ─────────────────────────────────────────────────────────────
test('computeTotal: excludeFromBillTotal 상품의 act_b는 제외하되 kpi_b는 합산한다', () => {
  const products = {
    '비즈링': product({ kpi_b: [100, ...Z12().slice(1)], act_b: [90, ...Z12().slice(1)] }),
    '용역': product({
      excludeFromBillTotal: true,
      kpi_b: [50, ...Z12().slice(1)],   // 실제 데이터에선 0이지만, 0이 아닐 때 어떻게 되는지를 고정한다
      act_b: [999, ...Z12().slice(1)]
    })
  };
  const t = C.computeTotal(products);
  assert.equal(t.act_b[0], 90, 'act_b는 제외 대상 상품을 빼고 합산');
  assert.equal(t.kpi_b[0], 150, 'kpi_b는 제외하지 않고 그대로 합산 (현재 동작을 고정)');
});

test('computeTotal: 매출(kpi_r/act_r)은 excludeFromBillTotal과 무관하게 항상 합산된다', () => {
  const products = {
    '비즈링': product({ kpi_r: [10, ...Z12().slice(1)], act_r: [8, ...Z12().slice(1)] }),
    '다윈': product({ excludeFromBillTotal: true, kpi_r: [20, ...Z12().slice(1)], act_r: [5, ...Z12().slice(1)] })
  };
  const t = C.computeTotal(products);
  assert.equal(t.kpi_r[0], 30);
  assert.equal(t.act_r[0], 13);
});

test('computeTotal: 상·하반기/연간 KPI 요약', () => {
  const products = { p: product({ kpi_b: [1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2], kpi_r: Z12() }) };
  const t = C.computeTotal(products);
  assert.equal(t.kpi_b_h1, 6);
  assert.equal(t.kpi_b_h2, 12);
  assert.equal(t.kpi_b_ann, 18);
});

test('computeTeam: 해당 팀 상품만 집계하고 prods에 원본을 담아준다', () => {
  const products = {
    '비즈링': product({ team: 'biz', act_r: [10, ...Z12().slice(1)] }),
    'ASUM': product({ team: 'mkt', act_r: [7, ...Z12().slice(1)] }),
    '신규미분류': product({ team: null, act_r: [5, ...Z12().slice(1)] })
  };
  const biz = C.computeTeam(products, 'biz');
  assert.deepEqual(Object.keys(biz.prods), ['비즈링']);
  assert.equal(biz.act_r[0], 10);
  const mkt = C.computeTeam(products, 'mkt');
  assert.deepEqual(Object.keys(mkt.prods), ['ASUM']);
  // team이 없는 상품은 어느 팀 탭에도 안 나오지만 전체 합계에는 들어간다.
  assert.equal(C.computeTotal(products).act_r[0], 22);
});

// ─────────────────────────────────────────────────────────────
// F-2 회귀: 분기별 상품 목록은 데이터에서 만들어야 한다 (하드코딩 금지)
// ─────────────────────────────────────────────────────────────
test('quarterSegmentProducts: 상품 목록을 data.json에서 동적으로 만든다 — 신규 상품도 자동 포함', () => {
  const products = {
    '비즈링': product({ kpi_b: [100, ...Z12().slice(1)], bill: [90, ...Z12().slice(1)], kpi_r: [10, ...Z12().slice(1)], rev: [80, ...Z12().slice(1)] }),
    '용역': product({ kpi_r: [10, ...Z12().slice(1)], rev: [50, ...Z12().slice(1)] }), // 취급고 KPI 없음
    '리사이즈애드': product({ kpi_b: [5, ...Z12().slice(1)], bill: [40, ...Z12().slice(1)], kpi_r: [5, ...Z12().slice(1)], rev: [40, ...Z12().slice(1)] })
  };
  const b = C.quarterSegmentProducts(products, 'b').map((x) => x.name);
  const r = C.quarterSegmentProducts(products, 'r').map((x) => x.name);
  assert.deepEqual(b, ['비즈링', '리사이즈애드'], '취급고 KPI가 없는 용역은 취급고 차트에서 빠진다');
  assert.deepEqual(r, ['비즈링', '용역', '리사이즈애드'], '매출 세그먼트에는 셋 다 포함');
  assert.ok(r.includes('리사이즈애드'), '코드 수정 없이 신규 상품이 나타나야 한다');
});

test('quarterSegmentProducts: 세그먼트에 KPI도 달성률도 없는 상품은 제외된다', () => {
  const products = { '기타': product({}) }; // 전부 0
  assert.deepEqual(C.quarterSegmentProducts(products, 'b'), []);
  assert.deepEqual(C.quarterSegmentProducts(products, 'r'), []);
});

test('quarterSegmentProducts: KPI는 있는데 실적이 아직 0인 상품도 목록에 남는다', () => {
  const products = { '신상품': product({ kpi_b: [100, ...Z12().slice(1)] }) }; // bill 전부 0
  assert.deepEqual(C.quarterSegmentProducts(products, 'b').map((x) => x.name), ['신상품']);
});

test('quarterRate: 값이 0인 달은 기본적으로 평균에서 빼고, 옵션을 켜면 포함한다', () => {
  const rates = [90, 0, 60, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  assert.equal(C.quarterRate(rates, 0, false), 75, '(90+60)/2');
  assert.equal(C.quarterRate(rates, 0, true), 50, '(90+0+60)/3');
  assert.equal(C.quarterRate(rates, 1, false), 0, '값이 하나도 없는 분기는 0');
  assert.equal(C.quarterRate([], 0, false), 0);
  assert.equal(C.quarterRate(undefined, 0, false), 0);
});

// ─────────────────────────────────────────────────────────────
// 주차별 비교 — 스냅샷이 부족할 때의 안전 처리
// ─────────────────────────────────────────────────────────────
const snap = (date, products) => ({ date, products });

test('computeWeeklyComparison: 스냅샷이 0개/1개면 빈 표 + 안내 문구를 돌려준다', () => {
  for (const hist of [undefined, [], [snap('2026-07-31', {})]]) {
    const w = C.computeWeeklyComparison(hist, 7);
    assert.deepEqual(w.rows, []);
    assert.equal(w.prev_label, '-');
    assert.equal(w.cur_label, '-');
    assert.match(w.note, /이전 스냅샷/);
  }
});

test('computeWeeklyProductChanges: 스냅샷이 0개/1개면 빈 목록', () => {
  for (const hist of [undefined, [], [snap('2026-07-31', {})]]) {
    assert.deepEqual(C.computeWeeklyProductChanges(hist, 7), { biz: [], mkt: [] });
  }
});

test('computeWeeklyComparison: 최신 2개를 (입력 순서와 무관하게) 날짜순으로 비교한다', () => {
  const mk = (actB) => ({ '비즈링': product({ kpi_b: [100, ...Z12().slice(1)], act_b: [actB, ...Z12().slice(1)] }) });
  const hist = [snap('2026-07-31', mk(80)), snap('2026-07-16', mk(10)), snap('2026-07-24', mk(50))];
  const w = C.computeWeeklyComparison(hist, 7);
  assert.equal(w.prev_label, '7/24');
  assert.equal(w.cur_label, '7/31');
  const bill = w.rows.find((r) => r.label === '취급고 달성률');
  assert.equal(bill.prev, 50);
  assert.equal(bill.cur, 80);
  const cum = w.rows.find((r) => r.label === '누적 취급고');
  assert.equal(cum.cur, 800000, '만원 → 원 변환');
});

test('computeWeeklyProductChanges: 이번 달 취급고가 바뀐 상품 전부를 변동폭 큰 순으로', () => {
  const at = (idx, v) => { const a = Z12(); a[idx] = v; return a; };
  const prev = {
    '비즈링': product({ team: 'biz', act_b: at(6, 100) }),
    '들리고': product({ team: 'biz', act_b: at(6, 10) }),
    'ASUM': product({ team: 'mkt', act_b: at(6, 5) }),
    '변동없음': product({ team: 'biz', act_b: at(6, 42) })
  };
  const cur = {
    '비즈링': product({ team: 'biz', act_b: at(6, 150) }),   // +50
    '들리고': product({ team: 'biz', act_b: at(6, 1010) }),  // +1000
    'ASUM': product({ team: 'mkt', act_b: at(6, 0) }),       // -5
    '변동없음': product({ team: 'biz', act_b: at(6, 42) }),
    '신규': product({ team: 'biz', act_b: at(6, 7) })        // 0 -> 7
  };
  const res = C.computeWeeklyProductChanges([snap('2026-07-24', prev), snap('2026-07-31', cur)], 7);
  assert.deepEqual(res.biz.map((r) => r.name), ['들리고', '비즈링', '신규'], '변동폭 내림차순, 변동 없는 상품은 제외');
  assert.equal(res.biz[0].month, '7월');
  assert.equal(res.biz[0].prev, 100000);
  assert.equal(res.biz[0].cur, 10100000);
  assert.equal(res.biz[2].prev, 0, '이전 스냅샷에 없던 상품은 prev=0(신규)');
  assert.deepEqual(res.mkt.map((r) => r.name), ['ASUM']);
});

test('computeWeeklyProductChanges: 스냅샷에 team이 없으면 현재 products 메타로 보완한다', () => {
  const at = (idx, v) => { const a = Z12(); a[idx] = v; return a; };
  const strip = (p) => { const q = Object.assign({}, p); delete q.team; return q; };
  const prev = { 'RMN': strip(product({ act_b: at(6, 1) })) };
  const cur = { 'RMN': strip(product({ act_b: at(6, 9) })) };
  const meta = { 'RMN': { team: 'mkt' } };
  const res = C.computeWeeklyProductChanges([snap('2026-07-24', prev), snap('2026-07-31', cur)], 7, meta);
  assert.deepEqual(res.mkt.map((r) => r.name), ['RMN']);
  assert.deepEqual(res.biz, []);
});

// ─────────────────────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────────────────────
test('sumN / pct / snapDateLabel', () => {
  assert.equal(C.sumN([1, 2, 3, 4], 2), 3);
  assert.equal(C.sumN([], 5), 0);
  assert.equal(C.sumN(undefined, 5), 0);
  assert.equal(C.pct(50, 200), 25);
  assert.equal(C.pct(1, 3), 33.3, '소수 첫째자리 반올림');
  assert.equal(C.pct(10, 0), 0, 'KPI가 0이면 0 (Infinity/NaN 아님)');
  assert.equal(C.snapDateLabel('2026-07-05'), '7/5');
});

test('빈 products를 넣어도 깨지지 않는다', () => {
  const t = C.computeTotal({});
  assert.equal(t.kpi_b.length, 12);
  assert.equal(t.kpi_b_ann, 0);
  assert.deepEqual(C.computeTeam({}, 'biz').prods, {});
  assert.deepEqual(C.teamTableRows(undefined, 7), []);
  assert.deepEqual(C.quarterSegmentProducts(undefined, 'b'), []);
});
