'use strict';
// Sends an anomaly alert to Slack (the only channel — an email channel via
// nodemailer/SMTP existed briefly but was removed at the user's request; see
// business-rules.md §6). Missing SLACK_WEBHOOK_URL just skips sending
// (logged as a ::warning::) and never blocks the sync itself (see
// sync.js's try/catch around the call site).

const { sendSlackAlert } = require('./notifySlack');

async function notifyAnomalies(anomalies, context) {
  if (!anomalies || anomalies.length === 0) return { slack: { sent: false, reason: 'no-anomalies' } };

  const slack = await sendSlackAlert(anomalies, context).catch((e) => ({ sent: false, reason: 'error', error: e.message }));
  return { slack };
}

module.exports = { notifyAnomalies };
