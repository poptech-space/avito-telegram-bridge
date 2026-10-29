const TABLES = ['records', 'queue'];
const { createAuthService } = require('./metadata-auth');
const silent = { trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {} };
class YdbBackend {
  constructor(env = process.env) {
    if (!env.YDB_ENDPOINT || !env.YDB_DATABASE) throw new Error('storage_not_configured');
    if (!/^grpcs:\/\/[a-zA-Z0-9.-]+:\d+$/.test(env.YDB_ENDPOINT) || !env.YDB_DATABASE.startsWith('/'))
      throw new Error('storage_requires_tls_and_database_path');
    this.env = env;
  }
  async driver() {
    if (!this.pending) this.pending = (async () => {
      const { Driver } = require('ydb-sdk');
      const authService = createAuthService(this.env);
      const driver = new Driver({ endpoint: this.env.YDB_ENDPOINT, database: this.env.YDB_DATABASE,
        authService, logger: silent });
      try {
        if (!await driver.ready(3000)) throw new Error('storage_unavailable');
      } catch (err) { await driver.destroy().catch(() => {}); throw err; }
      return driver;
    })().catch(err => { this.pending = null; throw err; });
    return this.pending;
  }
  async transaction(change) {
    const { TypedValues } = require('ydb-sdk');
    const driver = await this.driver();
    return driver.tableClient.withSession(async session => {
      const settings = { operationParams: { operationTimeout: { seconds: 2 }, cancelAfter: { seconds: 2 } } };
      const { id: txId } = await session.beginTransaction({ serializableReadWrite: {} }, settings);
      const control = { txId, commitTx: false };
      const tableName = name => {
        if (!TABLES.includes(name)) throw new Error('invalid_table');
        return `\`bot_${name}\``;
      };
      try {
        const result = await change({
          get: async (table, id) => {
            const response = await session.executeQuery(`DECLARE $id AS Utf8; SELECT document FROM ${tableName(table)} WHERE id = $id;`,
              { $id: TypedValues.utf8(id) }, control, settings);
            const cell = response.resultSets?.[0]?.rows?.[0]?.items?.[0];
            return cell?.textValue ? JSON.parse(cell.textValue) : null;
          },
          set: async (table, id, document) => session.executeQuery(
            `DECLARE $id AS Utf8; DECLARE $doc AS Utf8; DECLARE $expires AS Timestamp;
             UPSERT INTO ${tableName(table)} (id, document, expires_at) VALUES ($id, $doc, $expires);`,
            { $id: TypedValues.utf8(id), $doc: TypedValues.utf8(JSON.stringify(document)),
              $expires: TypedValues.timestamp(new Date(document.expires_at)) }, control, settings),
          delete: async (table, id) => session.executeQuery(`DECLARE $id AS Utf8; DELETE FROM ${tableName(table)} WHERE id = $id;`,
            { $id: TypedValues.utf8(id) }, control, settings),
        });
        await session.commitTransaction({ txId }, settings);
        return result;
      } catch (err) {
        await session.rollbackTransaction({ txId }, settings).catch(() => {});
        throw err;
      }
    }, 3000);
  }
  // Bounded, parameterized scan; callers must not export operation keys/documents.
  async scan(table, after = '', limit = 500, now = Date.now()) {
    if (!TABLES.includes(table) || !Number.isInteger(limit) || limit < 1 || limit > 1000)
      throw new Error('invalid_scan');
    const { TypedValues } = require('ydb-sdk');
    const driver = await this.driver();
    return driver.tableClient.withSession(async session => {
      const response = await session.executeQuery(
        `DECLARE $after AS Utf8; DECLARE $now AS Timestamp; DECLARE $limit AS Uint32;
         SELECT id, document FROM \`bot_${table}\`
         WHERE id > $after AND expires_at > $now ORDER BY id LIMIT $limit;`,
        { $after: TypedValues.utf8(after), $now: TypedValues.timestamp(new Date(now)),
          $limit: TypedValues.uint32(limit) },
        { beginTx: { serializableReadWrite: {} }, commitTx: true },
        { operationParams: { operationTimeout: { seconds: 2 }, cancelAfter: { seconds: 2 } } });
      return (response.resultSets?.[0]?.rows || []).map(row => ({
        id: row.items[0].textValue, document: JSON.parse(row.items[1].textValue),
      }));
    }, 3000);
  }
  async close() { if (this.pending) await (await this.pending).destroy(); }
}
module.exports = { YdbBackend, TABLES };
