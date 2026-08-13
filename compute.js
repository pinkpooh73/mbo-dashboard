/**
 * compute.js — 대시보드의 순수 계산 로직 (DOM/Chart.js 의존 없음).
 *
 * index.html의 <script> 안에 인라인으로 있던 집계 함수들을 그대로 옮겨온 것입니다.
 * 브라우저(<script src="compute.js">)와 Node.js(require) 양쪽에서 동작하며,
 * Node에서 require하면 sync/test/compute.test.js가 회귀 테스트를 돌립니다.
 *
 * 여기 있는 함수는 전부 "받은 값으로 계산해서 돌려주기"만 합니다 —
 * DOM을 만지거나 전역 상태를 읽지 않습니다(그래야 테스트가 가능합니다).
 *
 * 계산 규칙의 배경 설명은 business-rules.md 참고.
 */
(function (global) {
  'use strict';

  // ── 표시 임계값 ────────────────────────────────────────────────
  // 달성률 색상 구간. 인라인 숫자로 흩어져 있으면 조정할 때 놓치기 쉬워서
  // 이름 있는 상수로 둡니다(sync/detectAnomalies.js의 SPIKE_UP_RATIO와 같은 패턴).
  var RATE_ACHIEVED_PCT = 100; // 이상이면 초록(달성)
  var RATE_WARNING_PCT = 70;   // 이상이면 주황(주의), 미만이면 빨강(미달)

  var MONTH_LABELS = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];
  var QUARTER_LABELS = ['Q1', 'Q2', 'Q3', 'Q4'];

  // 분기 달성률을 낼 때 "실적이 0인 달"도 평균에 포함하는 상품.
  // 나머지 상품은 값이 있는 달(>0)만 평균 내서, 아직 입력되지 않은 달 때문에
  // 달성률이 실제보다 낮게 보이는 것을 피합니다.
  // (원래 index.html의 buildQProd/buildQTbl에 각각 리터럴로 박혀 있던 목록)
  var QUARTER_AVG_INCLUDE_ZERO = ['옥외광고', '다윈'];

  // ── 기본 헬퍼 ─────────────────────────────────────────────────
  function sumArr(arr) {
    return (arr || []).reduce(function (a, b) { return a + (b || 0); }, 0);
  }
  /** 배열의 앞 n개(=1~n월)만 합산. */
  function sumN(arr, n) {
    return sumArr((arr || []).slice(0, n));
  }
  /** 달성률(%) — 소수 첫째자리 반올림. KPI가 0/음수면 0. */
  function pct(actual, kpi) {
    return kpi > 0 ? Math.round(actual / kpi * 1000) / 10 : 0;
  }

  // ── 전체/팀 집계 (excludeFromBillTotal 플래그 기반) ────────────
  // 주의: 제외되는 것은 취급고 "실적"(act_b)뿐입니다. kpi_b는 합산되고,
  // 매출(kpi_r/act_r)은 어느 쪽도 제외되지 않습니다. business-rules.md §2 참고.
  function accumulate(products, filterFn) {
    var kb = new Array(12).fill(0), kr = new Array(12).fill(0);
    var ab = new Array(12).fill(0), ar = new Array(12).fill(0);
    var picked = {};
    Object.keys(products || {}).forEach(function (name) {
      var p = products[name];
      if (!p || (filterFn && !filterFn(name, p))) return;
      picked[name] = p;
      for (var i = 0; i < 12; i++) {
        kr[i] += (p.kpi_r && p.kpi_r[i]) || 0;
        ar[i] += (p.act_r && p.act_r[i]) || 0;
        kb[i] += (p.kpi_b && p.kpi_b[i]) || 0;
        if (!p.excludeFromBillTotal) ab[i] += (p.act_b && p.act_b[i]) || 0;
      }
    });
    return { kpi_b: kb, kpi_r: kr, act_b: ab, act_r: ar, prods: picked };
  }

  function computeTotal(products) {
    var t = accumulate(products, null);
    return {
      kpi_b: t.kpi_b, kpi_r: t.kpi_r, act_b: t.act_b, act_r: t.act_r,
      kpi_b_h1: sumArr(t.kpi_b.slice(0, 6)), kpi_b_h2: sumArr(t.kpi_b.slice(6, 12)), kpi_b_ann: sumArr(t.kpi_b),
      kpi_r_h1: sumArr(t.kpi_r.slice(0, 6)), kpi_r_h2: sumArr(t.kpi_r.slice(6, 12)), kpi_r_ann: sumArr(t.kpi_r)
    };
  }

  function computeTeam(products, team) {
    return accumulate(products, function (_name, p) { return p.team === team; });
  }

  // ── 팀 탭 "상품별 실적 상세" 표 ────────────────────────────────
  // 기준월 n(=오늘의 달)까지를 합산합니다. 예전에는 slice(0,6)이 하드코딩돼
  // 있어서 제목("1~7월")과 숫자(1~6월)가 어긋나는 버그가 있었습니다.
  function teamTableRows(prods, n) {
    return Object.keys(prods || {}).map(function (name) {
      var pd = prods[name] || {};
      var kb = sumN(pd.kpi_b, n), ab = sumN(pd.act_b, n);
      var kr = sumN(pd.kpi_r, n), ar = sumN(pd.act_r, n);
      return {
        name: name,
        kpi_b: kb, act_b: ab, billRate: pct(ab, kb),
        kpi_r: kr, act_r: ar, revRate: pct(ar, kr)
      };
    });
  }

  // ── 분기별 상품 달성률 ────────────────────────────────────────
  function hasSignal(arr) {
    return (arr || []).some(function (v) { return !!v; });
  }

  /**
   * 분기별 상품 차트/표에 넣을 상품 목록을 data.json에서 동적으로 만듭니다.
   * 상품명을 코드에 나열하지 않는 것이 핵심 — 예전에는 리터럴 목록이라
   * 신규 상품(리사이즈애드 등)이 화면에 영영 나타나지 않았습니다.
   *
   * 포함 기준: 해당 세그먼트에 "달성률을 말할 수 있는 근거"가 있는 상품.
   *   - 미리 계산된 달성률 배열(bill/rev)에 0이 아닌 값이 하나라도 있거나,
   *   - 그 세그먼트의 KPI(kpi_b/kpi_r)가 하나라도 잡혀 있는 경우.
   * (취급고 KPI가 아예 없는 용역·다윈이 취급고 차트에서 빠지는 것이 이 규칙의 결과)
   */
  function quarterSegmentProducts(products, seg) {
    var rateKey = seg === 'b' ? 'bill' : 'rev';
    var kpiKey = seg === 'b' ? 'kpi_b' : 'kpi_r';
    var out = [];
    Object.keys(products || {}).forEach(function (name) {
      var p = products[name] || {};
      if (!hasSignal(p[rateKey]) && !hasSignal(p[kpiKey])) return;
      out.push({ name: name, rates: p[rateKey] || [] });
    });
    return out;
  }

  /** 분기(0~3)의 달성률 평균. includeZeroMonths=false면 값이 0인 달은 평균에서 제외. */
  function quarterRate(rates, quarterIndex, includeZeroMonths) {
    var arr = rates || [];
    if (!arr.length) return 0;
    var slice = arr.slice(quarterIndex * 3, quarterIndex * 3 + 3);
    var vals = includeZeroMonths ? slice : slice.filter(function (v) { return v > 0; });
    if (!vals.length) return 0;
    return Math.round(sumArr(vals) / vals.length * 10) / 10;
  }

  // ── 주차별 비교 (snapshotHistory 최신 2개에서 계산) ─────────────
  function snapDateLabel(dateStr) {
    var dt = new Date(dateStr + 'T00:00:00');
    return (dt.getMonth() + 1) + '/' + dt.getDate();
  }

  // ── 주차별 비교: 갱신마다 흔들리지 않도록 "지난주 금요일 vs 이번주 금요일"만 쓴다 ──
  // Phase 4까지는 "가장 최근 스냅샷 2개"를 그대로 비교했는데,
  // 스케줄 동기화가 하루 4회씩 매 평일 돌면서 snapshotHistory가 날짜별로
  // 쌓이자 이 비교가 매번(예: 화요일→수요일) 바뀌어버렸다. "주차별" 비교라는
  // 이름에 맞게 금요일 스냅샷끼리만 비교하고, 그 사이 평일 동기화는 이 위젯에
  // 영향을 주지 않도록 고정한다. 대시보드의 다른 부분(카드, 표 등)은 여전히
  // data.json.products(최신 동기화 값)를 직접 쓰므로 매 동기화마다 갱신된다 —
  // 이 두 함수(와 이걸 쓰는 "주차별 핵심 지표 비교"/"상품별 주요 변동" 위젯)만
  // 영향을 받는다.
  function fridayOnOrBefore(date) {
    var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    var diff = (d.getDay() + 2) % 7; // 금=0, 토=1, 일=2, 월=3 ... 처럼 "지난/오늘 금요일까지 며칠 전인지"
    d.setDate(d.getDate() - diff);
    return d;
  }
  function toDateStr(d) {
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + mm + '-' + dd;
  }
  // 딱 그 금요일에 동기화가 없었으면(공휴일 등) 그 이전의 가장 최근 스냅샷으로 대체.
  function latestSnapshotOnOrBefore(snapshotHistory, dateStr) {
    var hist = (snapshotHistory || [])
      .filter(function (s) { return s.date <= dateStr; })
      .sort(function (a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); });
    return hist.length ? hist[hist.length - 1] : null;
  }
  function latestTwoFridaySnapshots(snapshotHistory, now) {
    var thisFri = fridayOnOrBefore(now || new Date());
    var lastFri = new Date(thisFri);
    lastFri.setDate(lastFri.getDate() - 7);
    var cur = latestSnapshotOnOrBefore(snapshotHistory, toDateStr(thisFri));
    var prev = latestSnapshotOnOrBefore(snapshotHistory, toDateStr(lastFri));
    if (!cur || !prev || cur.date === prev.date) return null;
    return { prev: prev, cur: cur };
  }

  function computeWeeklyComparison(snapshotHistory, n, now) {
    var pair = latestTwoFridaySnapshots(snapshotHistory, now);
    if (!pair) {
      return {
        prev_label: '-', cur_label: '-', rows: [],
        note: '비교할 금요일 스냅샷이 아직 2주치 쌓이지 않았습니다. 다음 금요일 동기화 이후 표시됩니다.'
      };
    }
    var pt = computeTotal(pair.prev.products), ct = computeTotal(pair.cur.products);
    var pb = sumN(pt.act_b, n), pk = sumN(pt.kpi_b, n), pr = sumN(pt.act_r, n), pkr = sumN(pt.kpi_r, n);
    var cb = sumN(ct.act_b, n), ck = sumN(ct.kpi_b, n), cr = sumN(ct.act_r, n), ckr = sumN(ct.kpi_r, n);
    return {
      prev_label: snapDateLabel(pair.prev.date), cur_label: snapDateLabel(pair.cur.date),
      rows: [
        { label: '취급고 달성률', prev: pct(pb, pk), cur: pct(cb, ck), unit: 'pct' },
        { label: '매출 달성률', prev: pct(pr, pkr), cur: pct(cr, ckr), unit: 'pct' },
        { label: '누적 취급고', prev: Math.round(pb * 10000), cur: Math.round(cb * 10000), unit: 'won' },
        { label: '누적 매출', prev: Math.round(pr * 10000), cur: Math.round(cr * 10000), unit: 'won' }
      ]
    };
  }

  /**
   * 이번 달 취급고 실적이 바뀐 상품 전부를 변동폭 큰 순으로. (top-N 고정 아님)
   * productsMeta는 스냅샷에 team이 없을 때의 보조 정보(현재 data.json.products).
   */
  function computeWeeklyProductChanges(snapshotHistory, n, productsMeta, now) {
    var pair = latestTwoFridaySnapshots(snapshotHistory, now);
    if (!pair) return { biz: [], mkt: [] };
    var meta = productsMeta || {};
    var monthIdx = Math.max(0, n - 1), monthLabel = MONTH_LABELS[monthIdx];
    function changesFor(team) {
      var rows = [];
      Object.keys(pair.cur.products || {}).forEach(function (name) {
        var p = pair.cur.products[name];
        var teamOf = p.team || (meta[name] && meta[name].team);
        if (teamOf !== team) return;
        var prevP = (pair.prev.products || {})[name];
        var prevVal = prevP ? ((prevP.act_b && prevP.act_b[monthIdx]) || 0) : 0;
        var curVal = (p.act_b && p.act_b[monthIdx]) || 0;
        if (curVal === prevVal) return;
        rows.push({
          name: name, month: monthLabel, kind: '취급고',
          prev: Math.round(prevVal * 10000), cur: Math.round(curVal * 10000)
        });
      });
      rows.sort(function (a, b) { return Math.abs(b.cur - b.prev) - Math.abs(a.cur - a.prev); });
      return rows;
    }
    return { biz: changesFor('biz'), mkt: changesFor('mkt') };
  }

  var api = {
    RATE_ACHIEVED_PCT: RATE_ACHIEVED_PCT,
    RATE_WARNING_PCT: RATE_WARNING_PCT,
    MONTH_LABELS: MONTH_LABELS,
    QUARTER_LABELS: QUARTER_LABELS,
    QUARTER_AVG_INCLUDE_ZERO: QUARTER_AVG_INCLUDE_ZERO,
    sumArr: sumArr,
    sumN: sumN,
    pct: pct,
    computeTotal: computeTotal,
    computeTeam: computeTeam,
    teamTableRows: teamTableRows,
    quarterSegmentProducts: quarterSegmentProducts,
    quarterRate: quarterRate,
    snapDateLabel: snapDateLabel,
    latestTwoFridaySnapshots: latestTwoFridaySnapshots,
    computeWeeklyComparison: computeWeeklyComparison,
    computeWeeklyProductChanges: computeWeeklyProductChanges
  };

  // 브라우저: 전역에 그대로 붙여 index.html이 예전처럼 이름으로 호출.
  Object.keys(api).forEach(function (k) { global[k] = api[k]; });
  // Node.js: require('../../compute.js')로 테스트에서 접근.
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
