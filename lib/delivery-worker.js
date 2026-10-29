const { claim, finish, recover } = require('./core');
// No send inside a database transaction: SDK retries must never resend a POST.
async function drainRecord(store, key, send, now = Date.now, deadline = Infinity) {
  const snapshot = await store.mutate(key, old => {
    if (!old) throw new Error('record_missing');
    recover(old, now()); return { state: old };
  });
  const ids = snapshot.state.submissions.flatMap(x => x.jobs).filter(x => x.status === 'pending').map(x => x.id);
  for (const id of ids.slice(0, 2)) {
    if (now() + 10000 >= deadline) break;
    const reservation = await store.mutate(key, old => ({ state: old, job: claim(old, id, now()) }));
    if (!reservation.job) continue;
    let status = 'unknown';
    try {
      const result = await send(reservation.job);
      // The adapter normalizes the provider's server-issued message identifier.
      status = result?.message?.body?.mid || result?.message?.mid ? 'sent' :
        result?.success === false || result?.ok === false ? 'rejected' : 'unknown';
    } catch (error) {
      // Only a definite client rejection proves no message was accepted. 5xx is ambiguous.
      status = Number(error.status) >= 400 && Number(error.status) < 500 ? 'rejected' : 'unknown';
    }
    await store.mutate(key, old => { finish(old, id, status, now()); return { state: old }; });
  }
}
module.exports = { drainRecord };
