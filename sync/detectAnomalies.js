'use strict';
// Data-quality anomaly detection, run against one sync's freshly-parsed
// products. Pure function of (products, monthIdx) — no network dependency —
// so it's fully unit-testable and doesn't block the sync if it errors (see
// how sync.js wraps the call).
//
// See business-rules.md "이상치 감지 규칙" for the human-readable version of
// what's implemented here and why.

// Tunable thresholds — see business-rules.md for the reasoning behind these
// specific numbers if you're tempted to tighten/loosen them.
const SPIKE_UP_RATIO = 5; // current >= 5x previous month => flag
const SPIKE_DOWN_RATIO = 0.2; // current <= 0.2x previous month => flag
const EQUAL_HISTORY_THRESHOLD = 0.5; // "usually equal" if >=50% of prior months matched

function seoulMonthIndex(now) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', month: 'numeric' })
    .format(now || new Date());
  return Number(parts) - 1; // 0-based, to match array indices
}

/**
 * @param {Object} products - result.products from parseSheet() (만원 units)
 * @param {number} [monthIdx] - 0-based "current reporting month" to compare
 *   against. Defaults to the current Asia/Seoul calendar month — NOT derived
 *   from the data itself. This matters: some products (e.g. 용역, a fixed
 *   recurring service line) have non-zero figures pre-filled all the way to
 *   December well before those months actually happen, so "last month with
 *   any nonzero value across all products" would silently drift the
 *   "current month" forward and compare against months that haven't
 *   happened yet for everyone else. Calendar date is the only reliable
 *   anchor (same reasoning as index.html's N — see business-rules.md).
 * @returns {Array<{type, product, month, detail}>}
 */
function detectAnomalies(products, monthIdx) {
  const anomalies = [];
  const curIdx = typeof monthIdx === 'number' ? monthIdx : seoulMonthIndex();
  if (curIdx < 0 || curIdx > 11) return anomalies;
  const monthNum = curIdx + 1;

  for (const [name, p] of Object.entries(products)) {
    // ── 1. 취급고 == 매출 완전 동일 (그 상품 입장에서 평소와 다른 경우만) ──
    const curB = p.act_b[curIdx] || 0;
    const curR = p.act_r[curIdx] || 0;
    if (curB > 0 && curB === curR) {
      let priorEqual = 0;
      let priorTotal = 0;
      for (let i = 0; i < curIdx; i++) {
        const b = p.act_b[i] || 0;
        const r = p.act_r[i] || 0;
        if (b > 0 || r > 0) {
          priorTotal++;
          if (b === r) priorEqual++;
        }
      }
      const usuallyEqual = priorTotal > 0 && priorEqual / priorTotal >= EQUAL_HISTORY_THRESHOLD;
      // priorTotal === 0 (첫 실적월)인 경우도 판단할 과거 데이터가 없으므로 건너뜀 —
      // 다음 달부터는 이 상품의 자체 이력이 쌓여 정상적으로 비교 가능해진다.
      if (!usuallyEqual && priorTotal > 0) {
        anomalies.push({
          type: 'BILL_EQUALS_REV',
          product: name,
          month: monthNum,
          detail: `${name}의 ${monthNum}월 취급고와 매출이 ${curB.toLocaleString()}만원으로 완전히 동일합니다. ` +
            `이 상품은 과거 ${priorTotal}개월 중 ${priorEqual}개월만 이랬던 걸로 봐서 평소 패턴과 다릅니다 — 컬럼이 잘못 복사됐을 가능성을 확인해 주세요.`
        });
      }
    }

    // ── 2. 전월 대비 급증/급감 ──
    if (curIdx >= 1) {
      for (const field of ['act_b', 'act_r']) {
        const prev = p[field][curIdx - 1] || 0;
        const cur = p[field][curIdx] || 0;
        if (prev <= 0) continue; // 0에서 시작하는 신규 활성화는 "급증"이 아니라 정상 — 스킵
        if (cur === 0) continue; // 정확히 0으로 떨어지는 건 "아직 입력 안 됨"일 가능성이 높음
        // (실제로 이 시트에서 흔한 패턴 — 소액 상품은 그 달 실적이 마감 전까지 0으로
        // 남아있다가 나중에 채워짐). 오타/단위 실수라면 보통 잘못된 값이 남지, 정확히
        // 0이 되지는 않는다 — 그래서 여기서는 급감 판정에서 제외한다.
        const ratio = cur / prev;
        if (ratio >= SPIKE_UP_RATIO || ratio <= SPIKE_DOWN_RATIO) {
          const label = field === 'act_b' ? '취급고' : '매출';
          const dir = ratio >= SPIKE_UP_RATIO ? '급증' : '급감';
          anomalies.push({
            type: 'MONTH_OVER_MONTH_SPIKE',
            product: name,
            field,
            month: monthNum,
            prev,
            cur,
            detail: `${name}의 ${label}가 전월 ${prev.toLocaleString()}만원 → 이번 달 ${cur.toLocaleString()}만원으로 ${dir}했습니다 ` +
              `(${Math.round(ratio * 100) / 100}배). 오타/단위 실수를 확인해 주세요.`
          });
        }
      }
    }
  }

  return anomalies;
}

module.exports = { detectAnomalies, seoulMonthIndex, SPIKE_UP_RATIO, SPIKE_DOWN_RATIO };
