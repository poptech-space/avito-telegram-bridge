#!/usr/bin/env node
// Offline smoke scenario only. No URL discovery, credentials or external POST.
const { createHandler } = require('../index');
const { memoryStore } = require('../test/memory-store.cjs');
if (process.argv.length > 2) {
  console.error('simulate is offline and accepts no URL or message arguments; use npm run emulator for JSON fixtures.');
  process.exitCode = 1;
} else {
  const store = memoryStore();
  const env = { TELEGRAM_CHAT_ID: '900', TELEGRAM_BOT_ID: '800', TELEGRAM_BOT_TOKEN: 'offline',
    TG_WEBHOOK_SECRET: 'offline-tg', AVITO_WEBHOOK_SECRET: 'offline-avito', AVITO_USER_ID: '700',
    AVITO_CLIENT_ID: 'offline', AVITO_CLIENT_SECRET: 'offline' };
  createHandler({ env, store })({ httpMethod: 'POST', queryStringParameters: { avito_secret: env.AVITO_WEBHOOK_SECRET },
    body: { id: 'fixture-event', chat_id: 'fixture-chat', author_id: 100, text: 'Fixture question' } })
    .then(result => {
      if (result.statusCode !== 200) throw new Error('offline_scenario_failed');
      console.log(JSON.stringify({ offline: true, received: JSON.parse(result.body), records: store.rows.size, delivered: false }));
    }).catch(() => { console.error('offline_scenario_failed'); process.exitCode = 1; });
}
