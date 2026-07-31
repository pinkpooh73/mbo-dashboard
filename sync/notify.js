'use strict';
// Sends a Slack notification when detectAnomalies() finds something.
// SLACK_WEBHOOK_URL comes from a GitHub Actions secret — never hardcode it
// (see sync.yml). If the secret isn't set, this just logs and no-ops, so a
// missing webhook never breaks the sync itself.

async function notifyAnomalies(anomalies, context) {
  if (!anomalies || anomalies.length === 0) return { sent: false, reason: 'no-anomalies' };

  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    console.log(`::warning::${anomalies.length}건의 이상치가 감지됐지만 SLACK_WEBHOOK_URL이 설정되지 않아 알림을 보내지 않았습니다.`);
    return { sent: false, reason: 'no-webhook' };
  }

  const lines = anomalies.map((a) => `• ${a.detail}`);
  const header = `⚠️ *미디어사업실 대시보드 데이터 이상치 감지* (${anomalies.length}건)`;
  const footer = context && context.sheetUrl ? `\n<${context.sheetUrl}|시트 열기>` : '';
  const text = `${header}\n${lines.join('\n')}${footer}`;

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.log(`::warning::Slack 알림 전송 실패 (HTTP ${res.status}): ${body.slice(0, 300)}`);
    return { sent: false, reason: 'http-error', status: res.status };
  }
  console.log(`Slack 알림 전송 완료 (${anomalies.length}건).`);
  return { sent: true };
}

module.exports = { notifyAnomalies };
