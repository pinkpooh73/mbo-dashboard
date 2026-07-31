'use strict';
// Sends a synthetic test alert through every configured channel (Slack,
// email), without needing Google Sheets credentials or a real sync. Useful
// for verifying SLACK_WEBHOOK_URL / SMTP_* / ALERT_EMAIL_TO are wired up
// correctly before trusting them in the real sync.yml run.
//
// Usage: set the relevant env vars, then `node scripts/testNotify.js`.
const { notifyAnomalies } = require('../notify');

const testAnomaly = [
  {
    type: 'TEST',
    product: '(테스트)',
    detail: '이것은 Phase 5 알림 연동을 확인하기 위한 테스트 메시지입니다. 실제 이상치가 아닙니다.'
  }
];

notifyAnomalies(testAnomaly, { sheetUrl: 'https://example.com/test-sheet' }).then((result) => {
  console.log('결과:', JSON.stringify(result, null, 2));
});
