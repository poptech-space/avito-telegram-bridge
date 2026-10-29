const { test } = require('node:test');
const assert = require('node:assert/strict');
const { authorize, equal, parse } = require('../lib/webhook-security');
test('fail closed and compare UTF-8 bytes safely', () => {
  assert.equal(authorize({}, {}, 'max').statusCode, 503);
  assert.equal(equal('aa', 'яя'), false);
  assert.equal(equal('', ''), false);
  assert.equal(authorize({ headers: { 'X-MAX-BOT-API-SECRET': 'secret' } }, { MAX_WEBHOOK_SECRET: 'secret' }, 'max'), null);
  assert.equal(authorize({ body: { update_type: 'message_created' } }, { MAX_WEBHOOK_SECRET: 'secret' }, 'max').statusCode, 403);
});
test('reject invalid JSON, null, arrays and oversized payload', () => {
  for (const body of ['{', 'null', '[]', '"x"', 'x'.repeat(65537)]) assert.throws(() => parse({ body }));
  assert.deepEqual(parse({ body: Buffer.from('{"ok":true}').toString('base64'), isBase64Encoded: true }), { ok: true });
});
