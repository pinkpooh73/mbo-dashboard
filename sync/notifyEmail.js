'use strict';
// Sends an email notification when detectAnomalies() finds something, via
// plain SMTP (nodemailer) — never a hardcoded credential. Expected env vars
// (GitHub Actions secrets in CI, see sync.yml):
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS  - the sending account
//   ALERT_EMAIL_TO                              - recipient(s), comma-separated
//   SMTP_FROM                                    - optional, defaults to SMTP_USER
//
// Injectable `transporter` param is for tests only — production callers
// should never pass one, so this module creates its own from env vars.
const nodemailer = require('nodemailer');

function buildTransport() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass }
  });
}

function renderHtml(anomalies) {
  const rows = anomalies.map((a) => `<li>${a.detail.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</li>`).join('');
  return `<p><b>미디어사업실 대시보드 데이터 이상치 감지</b> (${anomalies.length}건)</p><ul>${rows}</ul>`;
}

/**
 * @param {Array} anomalies - from detectAnomalies()
 * @param {Object} [context] - { sheetUrl }
 * @param {Object} [transporter] - test-only injection point
 */
async function sendEmailAlert(anomalies, context, transporter) {
  if (!anomalies || anomalies.length === 0) return { sent: false, reason: 'no-anomalies' };

  const to = process.env.ALERT_EMAIL_TO;
  if (!to) {
    console.log(`::warning::${anomalies.length}건의 이상치가 감지됐지만 ALERT_EMAIL_TO가 설정되지 않아 이메일을 보내지 않았습니다.`);
    return { sent: false, reason: 'no-recipient' };
  }

  const t = transporter || buildTransport();
  if (!t) {
    console.log(`::warning::${anomalies.length}건의 이상치가 감지됐지만 SMTP_HOST/SMTP_USER/SMTP_PASS가 설정되지 않아 이메일을 보내지 않았습니다.`);
    return { sent: false, reason: 'no-smtp-config' };
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const subject = `[미디어사업실 대시보드] 데이터 이상치 감지 ${anomalies.length}건`;
  const text = anomalies.map((a) => `- ${a.detail}`).join('\n') +
    (context && context.sheetUrl ? `\n\n시트: ${context.sheetUrl}` : '');

  try {
    await t.sendMail({ from, to, subject, text, html: renderHtml(anomalies) });
    console.log(`이메일 알림 전송 완료 (${anomalies.length}건, to: ${to}).`);
    return { sent: true };
  } catch (e) {
    console.log(`::warning::이메일 알림 전송 실패: ${e.message}`);
    return { sent: false, reason: 'send-error', error: e.message };
  }
}

module.exports = { sendEmailAlert, buildTransport };
