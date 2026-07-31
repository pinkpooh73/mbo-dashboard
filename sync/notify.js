'use strict';
// Fans out an anomaly alert to every configured channel (Slack, email).
// Each channel is independently optional — missing config for one channel
// just skips that channel (logged as a ::warning::) and never blocks the
// other, and never fails the sync itself (see sync.js's try/catch around
// the call site).

const { sendSlackAlert } = require('./notifySlack');
const { sendEmailAlert } = require('./notifyEmail');

async function notifyAnomalies(anomalies, context) {
  if (!anomalies || anomalies.length === 0) return { slack: { sent: false, reason: 'no-anomalies' }, email: { sent: false, reason: 'no-anomalies' } };

  const [slack, email] = await Promise.all([
    sendSlackAlert(anomalies, context).catch((e) => ({ sent: false, reason: 'error', error: e.message })),
    sendEmailAlert(anomalies, context).catch((e) => ({ sent: false, reason: 'error', error: e.message }))
  ]);
  return { slack, email };
}

module.exports = { notifyAnomalies };
