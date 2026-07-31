'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sendEmailAlert } = require('../notifyEmail');

const sampleAnomalies = [
  { type: 'MONTH_OVER_MONTH_SPIKE', product: '비즈링', detail: '비즈링의 취급고가 급증했습니다 (5.9배).' }
];

function withEnv(vars, fn) {
  const prev = {};
  for (const k of Object.keys(vars)) { prev[k] = process.env[k]; process.env[k] = vars[k]; }
  return Promise.resolve(fn()).finally(() => {
    for (const k of Object.keys(vars)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  });
}

test('no-ops (does not throw) when ALERT_EMAIL_TO is not set', async () => {
  await withEnv({ ALERT_EMAIL_TO: '' }, async () => {
    delete process.env.ALERT_EMAIL_TO;
    const result = await sendEmailAlert(sampleAnomalies, {});
    assert.equal(result.sent, false);
    assert.equal(result.reason, 'no-recipient');
  });
});

test('no-ops when ALERT_EMAIL_TO is set but SMTP credentials are missing', async () => {
  await withEnv({ ALERT_EMAIL_TO: 'robin@incross.com' }, async () => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    const result = await sendEmailAlert(sampleAnomalies, {});
    assert.equal(result.sent, false);
    assert.equal(result.reason, 'no-smtp-config');
  });
});

test('sends via the injected transporter with the right recipient/subject when fully configured', async () => {
  await withEnv({ ALERT_EMAIL_TO: 'robin@incross.com', SMTP_USER: 'bot@example.com' }, async () => {
    let captured = null;
    const fakeTransporter = {
      sendMail: async (opts) => { captured = opts; return { messageId: 'test-1' }; }
    };
    const result = await sendEmailAlert(sampleAnomalies, { sheetUrl: 'https://example.com/sheet' }, fakeTransporter);
    assert.equal(result.sent, true);
    assert.equal(captured.to, 'robin@incross.com');
    assert.equal(captured.from, 'bot@example.com');
    assert.match(captured.subject, /이상치 감지 1건/);
    assert.match(captured.text, /비즈링/);
    assert.match(captured.html, /비즈링/);
  });
});

test('reports a send failure without throwing', async () => {
  await withEnv({ ALERT_EMAIL_TO: 'robin@incross.com', SMTP_USER: 'bot@example.com' }, async () => {
    const failingTransporter = { sendMail: async () => { throw new Error('SMTP 550 rejected'); } };
    const result = await sendEmailAlert(sampleAnomalies, {}, failingTransporter);
    assert.equal(result.sent, false);
    assert.equal(result.reason, 'send-error');
  });
});

test('no-ops when there are no anomalies to report', async () => {
  const result = await sendEmailAlert([], {});
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'no-anomalies');
});
