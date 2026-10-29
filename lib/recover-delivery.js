const { YdbBackend } = require('./ydb-store');
const { createRecords } = require('./records');
const { retryRejected } = require('./core');
async function main(args = process.argv.slice(2)) {
  const backend = new YdbBackend();
  try {
    if (!args.includes('--retry-rejected')) {
      const after = args.includes('--after') ? args[args.indexOf('--after') + 1] || '' : '';
      const rows = await backend.scan('records', after, 50);
      const jobs = rows.filter(x => !x.id.startsWith('!')).flatMap(x => x.document.submissions.flatMap(s => s.jobs.filter(j => j.status !== 'sent').map(j => ({ record: x.id, job: j.id, status: j.status }))));
      console.log(JSON.stringify({ jobs, next: rows.at(-1)?.id || '' })); return;
    }
    const record = args[args.indexOf('--record') + 1], job = args[args.indexOf('--job') + 1];
    if (!args.includes('--record') || !args.includes('--job') || !/^[a-f0-9]{64}$/.test(record) || !job) throw new Error('explicit_record_and_job_required');
    const store = createRecords();
    try {
      await store.mutate(record, state => { retryRejected(state, job, Date.now()); return { state }; });
      console.log('Explicitly rejected job queued. Unknown deliveries cannot be retried.');
    } finally { await store.close(); }
  } finally { await backend.close(); }
}
if (require.main === module) main().catch(() => { console.error('recovery_refused_or_failed'); process.exitCode = 1; });
module.exports = { main };
