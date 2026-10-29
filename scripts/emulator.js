#!/usr/bin/env node
const readline = require('node:readline');
const { memoryStore } = require('../test/memory-store.cjs');
const store = memoryStore();
const { createHandler } = require('../index');
const env = { TELEGRAM_CHAT_ID: '900', TELEGRAM_BOT_ID: '800', TELEGRAM_BOT_TOKEN: 'offline', TG_WEBHOOK_SECRET: 'offline-tg',
 AVITO_WEBHOOK_SECRET: 'offline-avito', AVITO_USER_ID: '700', AVITO_CLIENT_ID: 'offline', AVITO_CLIENT_SECRET: 'offline' };
const handler = createHandler({ env, store });
console.log('Offline Avito bridge. One Avito event JSON per line. No network or sends.');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
(async () => { for await (const line of rl) {
 try { const body = JSON.parse(line); const reply = await handler({ httpMethod: 'POST', queryStringParameters: { avito_secret: env.AVITO_WEBHOOK_SECRET }, body });
 console.log(reply.body); console.log(JSON.stringify({ records: store.rows.size, pending: [...store.rows.values()].flatMap(s => s.submissions).flatMap(s => s.jobs).map(j => ({ target: j.target, status: j.status })) }));
 } catch (_) { console.log('Invalid fixture JSON'); }
} })().catch(() => { process.exitCode = 1; });
