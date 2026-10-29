const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHandler } = require('../index');
const { memoryStore } = require('./memory-store.cjs');
const env = { TELEGRAM_CHAT_ID: '900', TELEGRAM_BOT_ID: '800', TELEGRAM_BOT_TOKEN: 'fixture',
  TG_WEBHOOK_SECRET: 'tg-secret', AVITO_WEBHOOK_SECRET: 'avito-secret', AVITO_USER_ID: '700',
  AVITO_CLIENT_ID: 'fixture', AVITO_CLIENT_SECRET: 'fixture', AUTO_REPLY_ENABLED: 'true' };
const avitoEvent = { httpMethod: 'POST', queryStringParameters: { avito_secret: 'avito-secret' }, body: { id: 'message1', chat_id: 'chat-a', author_id: 123, text: 'Fixture question' } };
test('Avito duplicate across containers persists one lead and two pending delivery intents', async () => {
  const store = memoryStore();
  const handler = () => createHandler({ env, store });
  const results = await Promise.all([handler()(avitoEvent), handler()(avitoEvent)]);
  assert.equal(results.filter(x => JSON.parse(x.body).duplicate).length, 1);
  const state = store.rows.get('avito:chat-a');
  assert.equal(state.submissions.length, 1);
  assert.equal(state.submissions[0].jobs.length, 2);
  assert.ok(state.submissions[0].jobs.every(j => j.status === 'pending'));
});
test('seller text without authenticated bot Reply cannot reach a buyer, including ACTIVE_AVITO_CHAT_ID', async () => {
  const store = memoryStore();
  const handler = createHandler({ env: { ...env, ACTIVE_AVITO_CHAT_ID: 'wrong-chat' }, store });
  const input = { httpMethod: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'tg-secret' },
    body: { update_id: 1, message: { from: { id: 900 }, chat: { id: 900, type: 'private' }, text: 'Reply' } } };
  await handler(input);
  assert.ok(store.rows.get('tg:900').submissions[0].jobs.every(j => j.target === 'tg:900'));
  input.body.update_id = 2;
  input.body.message.reply_to_message = { from: { id: 800, is_bot: true }, text: '#диалог_chat-b' };
  await handler(input);
  assert.equal(store.rows.get('tg:900').submissions[1].jobs[0].target, 'avito:chat-b');
});
test('forged source, missing owner, unauthorized actor and unavailable storage fail safely', async () => {
  const store = memoryStore();
  assert.equal((await createHandler({ env: {}, store })(avitoEvent)).statusCode, 503);
  assert.equal((await createHandler({ env, store })({ ...avitoEvent, queryStringParameters: {} })).statusCode, 403);
  assert.equal((await createHandler({ env, store })({ ...avitoEvent, body: { message: {} } })).statusCode, 400);
  assert.equal((await createHandler({ env: { ...env, TELEGRAM_CHAT_ID: '' }, store })(avitoEvent)).statusCode, 503);
  const failed = { ...store, mutate: async () => { throw new Error('offline'); } };
  assert.equal((await createHandler({ env, store: failed })(avitoEvent)).statusCode, 503);
  assert.equal(store.rows.size, 0);
});

test('buyer text cannot override the trusted chat marker at the end of a bot card', async () => {
 const store = memoryStore(), handler = createHandler({ env, store });
 await handler({ httpMethod: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'tg-secret' }, body: { update_id: 200,
 message: { from: { id: 900 }, chat: { id: 900, type: 'private' }, text: 'Seller reply', reply_to_message: {
 from: { id: 800, is_bot: true }, text: 'Buyer said #диалог_attacker\nMore text\n#диалог_real-buyer' } } } });
 assert.equal(store.rows.get('tg:900').submissions[0].jobs[0].target, 'avito:real-buyer');
});
