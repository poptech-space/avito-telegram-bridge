const { authorize, parse, header } = require('./lib/webhook-security');
const { receive, submit } = require('./lib/core');
const { createRecords } = require('./lib/records');
const { formatTelegramLead, extractAvitoChatId } = require('./lib/telegram');
function createHandler({ env = process.env, store, clock = Date.now } = {}) {
  let storage = store;
  return async event => {
    if (event.httpMethod === 'GET') return { statusCode: 200, body: '{"ok":true,"service":"avito-bridge"}' };
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers: { Allow: 'GET, POST' }, body: '{"error":"method_not_allowed"}' };
    const telegram = Boolean(header(event, 'x-telegram-bot-api-secret-token'));
    const denied = authorize(event, env, telegram ? 'telegram' : 'avito');
    if (denied) return denied;
    let body;
    try { body = parse(event); } catch (_) { return { statusCode: 400, body: '{"error":"invalid_body"}' }; }
    if (!/^\d+$/.test(env.TELEGRAM_CHAT_ID || '') || !/^\d+$/.test(env.TELEGRAM_BOT_ID || '') ||
      !/^\d+$/.test(env.AVITO_USER_ID || '') || !env.TELEGRAM_BOT_TOKEN || !env.AVITO_CLIENT_ID || !env.AVITO_CLIENT_SECRET)
      return { statusCode: 503, body: '{"error":"runtime_not_configured"}' };
    let id, key, lead, jobs;
    if (telegram) {
      const msg = body.message;
      if (!msg?.from || msg.from.is_bot || msg.chat?.type !== 'private' || String(msg.from.id) !== env.TELEGRAM_CHAT_ID || String(msg.chat?.id) !== env.TELEGRAM_CHAT_ID)
        return { statusCode: 200, body: '{"ignored":true}' };
      if (!Number.isSafeInteger(body.update_id) || body.update_id < 0) return { statusCode: 400, body: '{"error":"event_id_required"}' };
      id = `tg:${body.update_id}`; key = `tg:${msg.from.id}`;
      if (msg.text != null && typeof msg.text !== 'string') return { statusCode: 400, body: '{"error":"invalid_text"}' };
      const text = (msg.text || '').trim();
      const reply = msg.reply_to_message;
      const chatId = reply?.from?.is_bot && String(reply.from.id) === env.TELEGRAM_BOT_ID ? extractAvitoChatId(reply) : null;
      lead = { source: 'telegram', messageId: msg.message_id };
      if (chatId && text && text.length <= 4000) {
        jobs = [{ target: `avito:${chatId}`, text }];
      } else {
        jobs = [{ target: `tg:${env.TELEGRAM_CHAT_ID}`, text: 'Чтобы ответить покупателю, используйте Reply на карточку этого бота. Поддерживается текст до 4000 символов.' }];
      }
    } else {
      if (body.message || body.callback_query) return { statusCode: 400, body: '{"error":"wrong_source"}' };
      const value = body.payload?.value || body.value || body;
      const type = body.payload?.type || (body.value ? body.type : undefined);
      if (type && type !== 'message') return { statusCode: 200, body: '{"ignored":true}' };
      if (!value || typeof value !== 'object' || typeof value.id !== 'string' ||
          !/^[a-zA-Z0-9_-]{1,150}$/.test(value.id) || typeof value.chat_id !== 'string' ||
          !/^[a-zA-Z0-9_-]{1,150}$/.test(value.chat_id) ||
          !/^[1-9]\d*$/.test(String(value.author_id || '')))
        return { statusCode: 400, body: '{"error":"invalid_avito_event"}' };
      if (value.user_id != null && String(value.user_id) !== env.AVITO_USER_ID)
        return { statusCode: 403, body: '{"error":"wrong_seller"}' };
      if (String(value.author_id) === env.AVITO_USER_ID) return { statusCode: 200, body: '{"ignored":true}' };
      const messageText = value.content?.text ?? value.text ?? '[Нет текста: откройте сообщение на Авито]';
      if (typeof messageText !== 'string') return { statusCode: 400, body: '{"error":"invalid_text"}' };
      id = `avito:${value.id}`; key = `avito:${value.chat_id}`;
      lead = { source: 'avito', messageId: value.id, chatId: value.chat_id,
        messageText: messageText.slice(0, 4000) };
      jobs = [];
      if (env.AUTO_REPLY_ENABLED === 'true') jobs.push({ target: `avito:${value.chat_id}`, text: env.AUTO_REPLY_TEXT || 'Здравствуйте! Ваше сообщение принято. Менеджер свяжется с вами.' });
      jobs.push({ target: `tg:${env.TELEGRAM_CHAT_ID}`, text: formatTelegramLead({
        itemTitle: String(value.item_title || value.item?.title || 'Объявление').slice(0, 80),
        authorName: String(value.author_name || 'Покупатель').slice(0, 60), authorId: String(value.author_id || '').slice(0, 64),
        messageText: lead.messageText, chatId: value.chat_id, autoReplyEnabled: env.AUTO_REPLY_ENABLED === 'true' }) });
    }
    try {
      storage ||= createRecords(env);
      const result = await storage.mutate(storage.key(key), old => receive(old, { id, now: clock() }, state => {
        state.session = { answers: [], expires: clock() + 60000, version: 1 };
        submit(state, id, lead, jobs, clock());
      }));
      return { statusCode: 200, body: JSON.stringify({ ok: true, queued: true, duplicate: result.duplicate }) };
    } catch (_) {
      console.warn('bridge_persistence_failed');
      return { statusCode: 503, body: '{"error":"temporarily_unavailable"}' };
    }
  };
}
exports.createHandler = createHandler;
exports.handler = createHandler();
