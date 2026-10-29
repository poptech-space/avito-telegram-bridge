const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createWorker } = require('../worker');
const { drainRecord } = require('../lib/delivery-worker');
const { memoryStore } = require('./memory-store.cjs');
const env = { DELIVERY_ENABLED: 'true', AVITO_USER_ID: '700', TELEGRAM_CHAT_ID: '900',
  TELEGRAM_BOT_TOKEN: 'fixture', AVITO_CLIENT_ID: 'fixture', AVITO_CLIENT_SECRET: 'fixture' };
const seed = (store, targets) => store.rows.set('record', { expires_at: 99999999,
  submissions: [{ jobs: targets.map((target, i) => ({ id: `job-${i}`, target, text: 'fixture', status: 'pending', updated: 0 })) }] });
const jobs = store => store.rows.get('record').submissions[0].jobs;

test('delivery defaults to disabled and HTTP invocation cannot drain pending jobs', async () => {
  const store = memoryStore(); seed(store, ['tg:900']);
  const sendTelegram = () => assert.fail('disabled/private worker must not send');
  assert.equal((await createWorker({ env: { ...env, DELIVERY_ENABLED: undefined }, store, sendTelegram })({})).skipped, 'delivery_disabled');
  assert.equal((await createWorker({ env, store, sendTelegram })({ httpMethod: 'POST' })).statusCode, 403);
  assert.equal(jobs(store)[0].status, 'pending');
});

test('real worker normalizes Avito/Telegram success and refuses foreign operator targets', async () => {
  const store = memoryStore(); seed(store, ['avito:fixture-chat', 'tg:901', 'tg:900']);
  const sent = [];
  const worker = createWorker({ env, store, clock: () => 100,
    accessToken: async () => 'fixture-access',
    sendAvito: async (token, seller, chat) => { sent.push([seller, chat]); return { id: 'accepted' }; },
    sendTelegram: async (token, recipient) => { sent.push([recipient]); return { ok: true, result: { message_id: 1 } }; } });
  await worker({});
  assert.deepEqual(sent, [['700', 'fixture-chat'], ['900']]);
  assert.deepEqual(jobs(store).map(x => x.status), ['sent', 'unknown', 'sent']);
});

test('timeout and 5xx stay unknown, definite rejection stays rejected; neither is resent', async () => {
  for (const [status, expected] of [[undefined, 'unknown'], [503, 'unknown'], [400, 'rejected']]) {
    const store = memoryStore(); seed(store, ['tg:900']); let calls = 0;
    const send = async () => { calls++; const error = new Error('fixture'); error.status = status; throw error; };
    await drainRecord(store, 'record', send, () => 100);
    await drainRecord(store, 'record', send, () => 100000);
    assert.equal(calls, 1); assert.equal(jobs(store)[0].status, expected);
  }
});

test('concurrent drains claim a job once and never repeat a POST after result persistence fails', async () => {
  const store = memoryStore(); seed(store, ['tg:900']); let calls = 0;
  const send = async () => { calls++; return { message: { mid: 'accepted' } }; };
  await Promise.all([drainRecord(store, 'record', send, () => 100), drainRecord(store, 'record', send, () => 100)]);
  assert.equal(calls, 1);
  seed(store, ['tg:900']); calls = 0;
  const unstable = { ...store, mutate: async (key, change) => {
    if (calls) throw new Error('commit unavailable');
    return store.mutate(key, change);
  } };
  await assert.rejects(drainRecord(unstable, 'record', send, () => 100));
  assert.equal(jobs(store)[0].status, 'sending');
  await drainRecord(store, 'record', () => assert.fail('unknown result cannot repeat'), () => 60200);
  assert.equal(jobs(store)[0].status, 'unknown');
});

test('time budget leaves the second job pending instead of starting another slow POST', async () => {
  const store = memoryStore(); seed(store, ['tg:900', 'tg:900']); let now = 0;
  await drainRecord(store, 'record', async () => { now += 11000; return { message: { mid: 'accepted' } }; }, () => now, 20000);
  assert.deepEqual(jobs(store).map(x => x.status), ['sent', 'pending']);
});
