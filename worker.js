const { createRecords } = require('./lib/records');
const { runScheduled } = require('./lib/scan-worker');
const { getAccessToken, sendAvitoMessage } = require('./lib/avito');
const { sendTelegramMessage } = require('./lib/telegram');
function createWorker({ env = process.env, store, clock = Date.now,
  accessToken = getAccessToken, sendAvito = sendAvitoMessage, sendTelegram = sendTelegramMessage } = {}) {
 return async event => {
  if (event.httpMethod) return { statusCode: 403, body: 'private_worker' };
  // A newly deployed function must not drain a backlog merely because its timer runs.
  if (env.DELIVERY_ENABLED !== 'true') return { skipped: 'delivery_disabled' };
  if (!/^[1-9]\d*$/.test(env.AVITO_USER_ID || '') || !/^[1-9]\d*$/.test(env.TELEGRAM_CHAT_ID || '') ||
      !env.TELEGRAM_BOT_TOKEN || !env.AVITO_CLIENT_ID || !env.AVITO_CLIENT_SECRET)
    throw new Error('worker_not_configured');
  store ||= createRecords(env);
  return runScheduled(store, async job => {
    const separator = job.target.indexOf(':'), platform = job.target.slice(0, separator), target = job.target.slice(separator + 1);
    if (platform === 'avito') {
      if (!/^[a-zA-Z0-9_-]{1,150}$/.test(target)) throw new Error('invalid_delivery_target');
      // Resolve auth before POST; failures remain ambiguous/conservative in delivery status.
      const token = await accessToken(env.AVITO_CLIENT_ID, env.AVITO_CLIENT_SECRET);
      const result = await sendAvito(token, env.AVITO_USER_ID, target, job.text);
      return result?.id ? { message: { mid: String(result.id) } } : {};
    }
    if (platform !== 'tg' || target !== env.TELEGRAM_CHAT_ID) throw new Error('invalid_delivery_target');
    const result = await sendTelegram(env.TELEGRAM_BOT_TOKEN, target, job.text);
    return result?.ok && result.result?.message_id ? { message: { mid: String(result.result.message_id) } } : {};
  }, clock);
 };
}
exports.createWorker = createWorker;
exports.handler = createWorker();
