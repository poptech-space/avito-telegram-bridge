const assert = require('node:assert/strict');
const { getAccessToken, sendAvitoMessage } = require('../lib/avito');
const { sendTelegramMessage, formatTelegramLead, extractAvitoChatId } = require('../lib/telegram');
(async () => {
  const original = global.fetch, requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    assert.ok(options.signal, 'network requests must have a deadline');
    if (url.includes('/token/')) return Response.json({ access_token: 'fixture-access', expires_in: 3600 });
    if (url.includes('/messages')) return Response.json({ id: 'fixture-message' });
    return Response.json({ ok: true, result: { message_id: 123 } });
  };
  try {
    const token = await getAccessToken('fixture-client', 'fixture-secret');
    assert.equal(token, 'fixture-access');
    assert.equal((await sendAvitoMessage(token, 100, 'fixture-chat', 'hello')).id, 'fixture-message');
    assert.equal(JSON.parse(requests[1].options.body).message.text, 'hello');
    assert.equal(requests[1].options.headers.Authorization, 'Bearer fixture-access');
    assert.equal((await sendTelegramMessage('fixture-token', '900', 'hello')).result.message_id, 123);
    global.fetch = async () => Response.json({ ok: false, error_code: 400 });
    await assert.rejects(sendTelegramMessage('fixture-token', '900', 'hello'), /telegram_rejected/);
  } finally { global.fetch = original; }
  const card = formatTelegramLead({ authorName: '<bad>', messageText: '<script>', chatId: 'fixture-chat' });
  assert.ok(card.includes('&lt;script&gt;'));
  assert.equal(extractAvitoChatId({ text: card.replace(/<[^>]*>/g, '') }), 'fixture-chat');
  console.log('Avito/Telegram HTTP contract, timeouts, explicit API rejection and escaping: passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
