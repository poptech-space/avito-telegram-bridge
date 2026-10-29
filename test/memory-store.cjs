// Test/emulator adapter only. Production always uses YDB/SQLite.
function memoryStore() {
  const rows = new Map(); let chain = Promise.resolve();
  return { rows, key: String,
    async mutate(key, change) {
      const pending = chain.then(async () => {
        const result = await change(rows.has(key) ? structuredClone(rows.get(key)) : null);
        rows.set(key, structuredClone(result.state)); return result;
      });
      chain = pending.catch(() => {}); return pending;
    },
    async scan(after = '0', limit = 10) {
      return [...rows].filter(([key, doc]) => key > after && !key.startsWith('!') && doc.submissions?.some(s => s.jobs.some(j => ['pending', 'sending'].includes(j.status))))
        .sort(([a], [b]) => a.localeCompare(b)).slice(0, limit).map(([id, document]) => ({ id, document }));
    }
  };
}
module.exports = { memoryStore };
