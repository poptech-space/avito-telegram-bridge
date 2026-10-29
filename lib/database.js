const { YdbBackend, TABLES } = require('./ydb-store');
const ddl = TABLES.map(name => `CREATE TABLE IF NOT EXISTS \`bot_${name}\` (
 id Utf8 NOT NULL, document Utf8 NOT NULL, expires_at Timestamp NOT NULL,
 PRIMARY KEY (id)
) WITH (TTL = Interval("PT0S") ON expires_at);`);
async function main(args = process.argv.slice(2)) {
  if (!args.includes('--execute')) { console.log(ddl.join('\n\n')); return; }
  const target = args[args.indexOf('--database') + 1];
  if (!args.includes('--database') || !target || target !== process.env.YDB_DATABASE) throw new Error('explicit_target_database_required');
  const backend = new YdbBackend();
  try {
    const driver = await backend.driver();
    for (const query of ddl) await driver.queryClient.do({ fn: async session => {
      const result = await session.execute({ text: query }); await result.opFinished;
    } });
    console.log('Tables prepared. Verify TTL and access bindings before releasing ingress.');
  } finally { await backend.close(); }
}
if (require.main === module) main().catch(() => { console.error('database_operation_failed_inspect_schema'); process.exitCode = 1; });
module.exports = { ddl, main };
