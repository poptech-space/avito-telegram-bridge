const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runScheduled } = require('../lib/scan-worker');
const { memoryStore } = require('./memory-store.cjs');
const make = id => ({ submissions: [{ jobs: [{ id, target: '900', text: 'fixture', status: 'pending', updated: 1 }] }], expires_at: 9999999 });
test('concurrent timer invocations acquire one persistent lease and drain each record once', async () => {
 const store = memoryStore(); store.rows.set('a', make('a')); store.rows.set('b', make('b'));
 let sent = 0;
 const replies = await Promise.all([runScheduled(store, async () => { sent++; return { message: { body: { mid: 'ok' } } }; }, () => 100), runScheduled(store, async () => assert.fail('second lease must not send'), () => 100)]);
 assert.equal(replies.filter(x => x.skipped === 'worker_busy').length, 1);
 assert.equal(sent, 2); assert.ok([...store.rows].filter(([key]) => !key.startsWith('!')).every(([, s]) => s.submissions[0].jobs[0].status === 'sent'));
});
test('crash after claim becomes unknown after lease expiry, without a second POST', async () => {
 const store = memoryStore(); const record = make('a'); record.submissions[0].jobs[0].status = 'sending';
 store.rows.set('a', record); store.rows.set('!worker-cursor', { cursor: '0', until: 60000, expires_at: 9999999 });
 assert.equal((await runScheduled(store, async () => assert.fail('busy worker'), () => 1)).skipped, 'worker_busy');
 await runScheduled(store, async () => assert.fail('ambiguous send must not repeat'), () => 61002);
 assert.equal(store.rows.get('a').submissions[0].jobs[0].status, 'unknown');
});
