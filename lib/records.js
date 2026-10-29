const { createHmac } = require('node:crypto');
const { YdbBackend } = require('./ydb-store');
function createRecords(env = process.env) {
  if (!env.BOT_DATA_SECRET || env.BOT_DATA_SECRET.length < 32) throw new Error('data_secret_required');
  const backend = new YdbBackend(env);
  return {
    key: actor => createHmac('sha256', env.BOT_DATA_SECRET).update(String(actor)).digest('hex'),
    async mutate(key, change) {
      return backend.transaction(async tx => {
        const old = await tx.get('records', key);
        const result = await change(old);
        await tx.set('records', key, result.state);
        if (!key.startsWith('!')) {
          const pending = result.state.submissions?.some(s => s.jobs.some(j => ['pending', 'sending'].includes(j.status)));
          if (pending) await tx.set('queue', key, { expires_at: result.state.expires_at });
          else await tx.delete('queue', key);
        }
        return result;
      });
    },
    close: () => backend.close(),
    scan: (after = '', limit = 100) => backend.scan('queue', after, limit),
  };
}
module.exports = { createRecords };
