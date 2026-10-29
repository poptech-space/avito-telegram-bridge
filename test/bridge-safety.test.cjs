const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHandler } = require('../index');
const { memoryStore } = require('./memory-store.cjs');
const { formatTelegramLead, extractAvitoChatId } = require('../lib/telegram');
const env = { TELEGRAM_CHAT_ID: '900', TELEGRAM_BOT_ID: '800', TELEGRAM_BOT_TOKEN: 'fixture',
  TG_WEBHOOK_SECRET: 'fixture-tg', AVITO_WEBHOOK_SECRET: 'fixture-avito', AVITO_USER_ID: '700',
  AVITO_CLIENT_ID: 'fixture', AVITO_CLIENT_SECRET: 'fixture' };
const avito = value => ({ httpMethod: 'POST', queryStringParameters: { avito_secret: env.AVITO_WEBHOOK_SECRET }, body: value });
const message = { id: 'fixture-event', chat_id: 'fixture-chat', author_id: 100, text: 'Question' };
const telegram = overrides => ({ httpMethod: 'POST', headers: { 'x-telegram-bot-api-secret-token': env.TG_WEBHOOK_SECRET },
  body: { update_id: 1, message: { from: { id: 900 }, chat: { id: 900, type: 'private' }, text: 'Answer',
    reply_to_message: { from: { id: 800, is_bot: true }, text: '#диалог_fixture-chat' } }, ...overrides } });

test('invalid Avito IDs, seller, author and text cannot create any delivery', async () => {
  const store = memoryStore(), handler = createHandler({ env, store });
  for (const patch of [{ id: {} }, { id: 'x'.repeat(151) }, { chat_id: {} }, { author_id: null }, { text: {} }])
    assert.equal((await handler(avito({ ...message, ...patch }))).statusCode, 400);
  assert.equal((await handler(avito({ ...message, user_id: 701 }))).statusCode, 403);
  assert.equal((await handler(avito({ type: 'message_read', value: message }))).statusCode, 200);
  assert.equal(store.rows.size, 0);
});

test('private owner, valid update ID, own bot and explicit Reply are all required', async () => {
  const store = memoryStore(), handler = createHandler({ env, store });
  for (const update_id of [null, {}, -1, '1', Number.MAX_SAFE_INTEGER + 1])
    assert.equal((await handler(telegram({ update_id }))).statusCode, 400);
  const group = telegram(); group.body.message.chat.type = 'group';
  await handler(group);
  assert.equal(store.rows.size, 0);
  const malformed = telegram(); malformed.body.message.text = {};
  assert.equal((await handler(malformed)).statusCode, 400);
  const forged = telegram(); forged.body.message.reply_to_message.from.id = 801;
  await handler(forged);
  assert.ok(store.rows.get('tg:900').submissions[0].jobs.every(job => job.target === 'tg:900'));
});

test('long escaped buyer text stays bounded and preserves the authoritative terminal route', async () => {
  const store = memoryStore();
  const result = await createHandler({ env, store })(avito({ ...message, text: '&<>🙂'.repeat(2000) }));
  assert.equal(result.statusCode, 200);
  const jobs = store.rows.get('avito:fixture-chat').submissions[0].jobs;
  assert.equal(jobs.length, 1, 'auto-reply must be opt-in');
  assert.ok(jobs[0].text.length <= 4000);
  assert.match(jobs[0].text, /Полный текст/);
  assert.match(jobs[0].text, /Автоответ выключен/);
  assert.doesNotMatch(jobs[0].text, /значок|защищен|Автоответ отправлен/);
  assert.equal(extractAvitoChatId({ text: jobs[0].text.replace(/<[^>]*>/g, '') }), 'fixture-chat');
  assert.equal(extractAvitoChatId({ text: {} }), null);
  assert.doesNotMatch(formatTelegramLead({ chatId: 'fixture', autoReplyEnabled: true }), /Автоответ отправлен/);
});

test('only GET health and authenticated POST are accepted; health never accesses storage', async () => {
  const handler = createHandler({ env: {}, store: { mutate: () => assert.fail('health must be read-only') } });
  assert.equal((await handler({ httpMethod: 'GET' })).statusCode, 200);
  for (const httpMethod of ['PUT', 'DELETE', 'OPTIONS']) assert.equal((await handler({ httpMethod })).statusCode, 405);
});
