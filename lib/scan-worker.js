const { randomUUID } = require('node:crypto');
const { drainRecord } = require('./delivery-worker');
// A persistent lease limits a bot to one bounded sender invocation, even across instances.
async function runScheduled(store, send, clock = Date.now) {
  const owner = randomUUID(), key = '!worker-cursor';
  const reservation = await store.mutate(key, old => {
    const state = old || { cursor: '0' };
    if (state.until > clock()) return { state, acquired: false };
    return { state: { ...state, owner, until: clock() + 60000, expires_at: clock() + 90 * 86400000 }, acquired: true };
  });
  if (!reservation.acquired) return { skipped: 'worker_busy' };
  const deadline = clock() + 20000;
  let cursor = reservation.state.cursor, processed = 0;
  while (processed < 10 && clock() + 10000 < deadline) {
    let rows = await store.scan(cursor, 1);
    if (!rows.length) rows = await store.scan('0', 1);
    if (!rows.length) break;
    const row = rows[0];
    await drainRecord(store, row.id, send, clock, deadline);
    cursor = row.id; processed++;
  }
  await store.mutate(key, state => {
    if (state.owner !== owner) throw new Error('worker_lease_lost');
    return { state: { ...state, cursor, until: Math.max(0, reservation.state.until - 59000) } };
  });
  return { processed };
}
module.exports = { runScheduled };
