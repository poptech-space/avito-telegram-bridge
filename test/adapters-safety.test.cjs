const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getAccessToken, registerAvitoWebhook, deleteAvitoWebhook, sendAvitoMessage } = require('../lib/avito');
const { sendTelegramMessage, setTelegramWebhook } = require('../lib/telegram');

test('OAuth cache is scoped to client credentials and never reuses a token after credential rotation', async () => {
  const original = global.fetch; let calls = 0;
  global.fetch = async () => Response.json({ access_token: `fixture-${++calls}`, expires_in: 3600 });
  try {
    assert.equal(await getAccessToken('fixture-a', 'fixture-a-secret'), 'fixture-1');
    assert.equal(await getAccessToken('fixture-a', 'fixture-a-secret'), 'fixture-1');
    assert.equal(await getAccessToken('fixture-b', 'fixture-b-secret'), 'fixture-2');
    assert.equal(await getAccessToken('fixture-b', 'fixture-rotated'), 'fixture-3');
  } finally { global.fetch = original; }
});

test('provider error bodies cannot escape through adapter errors and explicit rejection retains its code', async () => {
  const original = global.fetch;
  global.fetch = async () => new Response('fixture-private-response', { status: 400 });
  try {
    for (const action of [() => getAccessToken('fixture-error', 'fixture-secret'),
      () => sendAvitoMessage('fixture-token', '700', 'fixture-chat', 'hello'),
      () => registerAvitoWebhook('fixture-token', 'https://example.invalid/'),
      () => deleteAvitoWebhook('fixture-token', 'https://example.invalid/'),
      () => sendTelegramMessage('fixture-token', '900', 'hello')])
      await assert.rejects(action(), error => error.status === 400 && !error.message.includes('fixture-private-response'));
  } finally { global.fetch = original; }
});

test('malformed OAuth success is not cached and webhook registration rejects unsafe configuration before HTTP', async () => {
  const original = global.fetch;
  global.fetch = async () => Response.json({ expires_in: 3600 });
  try {
    await assert.rejects(getAccessToken('fixture-malformed', 'fixture-secret'), /invalid_response/);
    global.fetch = () => assert.fail('invalid registration must not contact Telegram');
    for (const url of ['http://example.invalid/', 'https://user:pass@example.invalid/', 'https://example.invalid/?secret=fixture'])
      await assert.rejects(setTelegramWebhook('fixture-token', url, 'fixture'.repeat(5)));
    await assert.rejects(setTelegramWebhook('fixture-token', 'https://example.invalid/', 'short'));
  } finally { global.fetch = original; }
});

test('invalid JSON from a successful HTTP response does not leak provider body snippets', async () => {
  const original = global.fetch;
  global.fetch = async (url, options) => {
    assert.equal(options.redirect, 'error');
    return new Response('fixture-private-invalid-json');
  };
  try {
    for (const action of [() => getAccessToken('fixture-json', 'fixture-secret'),
      () => sendAvitoMessage('fixture-token', '700', 'fixture-chat', 'hello'),
      () => sendTelegramMessage('fixture-token', '900', 'hello')])
      await assert.rejects(action(), error => error.message === 'provider_invalid_json');
  } finally { global.fetch = original; }
});
