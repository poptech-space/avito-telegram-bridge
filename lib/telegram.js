/**
 * Модуль взаимодействия с Telegram Bot API
 * Поддерживает отправку лидов, парсинг Reply-ответов и отправку команд
 */

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Отправка структурированного уведомления о лиде продавцу в Telegram
 */
function formatTelegramLead(leadData) {
  const {
    itemTitle = 'Товар / Услуга',
    authorName = 'Клиент',
    authorId = '',
    messageText = '',
    chatId: avitoChatId = '',
    autoReplySent = false,
    autoReplyEnabled = false
  } = leadData;

  const directAvitoUrl = avitoChatId 
    ? `https://www.avito.ru/profile/messenger/channel/${encodeURIComponent(avitoChatId)}`
    : 'https://www.avito.ru/profile/messenger';

  const lines = content => [
    '🚨 <b>Новое обращение на Авито!</b>',
    '',
    `📦 <b>Объявление:</b> ${escapeHtml(itemTitle)}`,
    `👤 <b>Покупатель:</b> ${escapeHtml(authorName)} (ID: <code>${escapeHtml(authorId)}</code>)`,
    `💬 <b>Текст:</b> «<i>${escapeHtml(content)}</i>»`,
    '',
    autoReplySent 
      ? '⚡️ <i>Автоответ отправлен.</i>'
      : autoReplyEnabled ? 'ℹ️ <i>Автоответ поставлен в очередь; доставка не подтверждена.</i>'
        : 'ℹ️ <i>Автоответ выключен.</i>',
    '',
    `<a href="${directAvitoUrl}">Открыть диалог на Авито</a>`,
    '',
    '✍️ <i>Ответьте на это сообщение (Reply), чтобы отправить ответ покупателю в чат Авито:</i>',
    `<code>#диалог_${escapeHtml(avitoChatId)}</code>`
  ];

  // Bound the escaped HTML too: repeated '&' may expand fivefold. Keep the
  // authoritative route marker intact, and make any truncation visible.
  let content = String(messageText), truncated = false;
  while (lines(content + (truncated ? '… [Полный текст — на Авито]' : '')).join('\n').length > 4000 && content.length) {
    content = Array.from(content).slice(0, -100).join('');
    truncated = true;
  }
  return lines(content + (truncated ? '… [Полный текст — на Авито]' : '')).join('\n');
}
async function sendTelegramLead(botToken, chatId, leadData) {
  return sendTelegramMessage(botToken, chatId, formatTelegramLead(leadData));
}

/**
 * Извлечение ID чата Авито из цитируемого сообщения (Reply)
 */
function extractAvitoChatId(replyToMessage) {
  if (!replyToMessage) return null;
  const text = replyToMessage.text || replyToMessage.caption || '';
  if (typeof text !== 'string') return null;
  
  // Ищем #диалог_u2i-... или #диалог_...
  const match = text.match(/(?:^|\n)#диалог_([a-zA-Z0-9_-]{1,150})\s*$/);
  if (match && match[1]) {
    return match[1];
  }
  return null;
}

/**
 * Базовая отправка текстового сообщения в Telegram
 */
async function sendTelegramMessage(botToken, chatId, text, options = {}) {
  const payload = {
    chat_id: chatId,
    text: text,
    parse_mode: options.parse_mode || 'HTML',
    reply_to_message_id: options.reply_to_message_id,
    reply_markup: options.reply_markup
  };
  return await sendTelegramRaw(botToken, 'sendMessage', payload);
}

/**
 * Низкоуровневый вызов метода Telegram Bot API
 */
async function sendTelegramRaw(botToken, method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    signal: AbortSignal.timeout(5000),
    redirect: 'error',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const error = new Error(`Telegram ${method} failed [${res.status}]`); error.status = res.status; throw error;
  }

  const result = await safeJson(res);
  if (result.ok !== true) { const error = new Error('telegram_rejected'); error.status = result.error_code; throw error; }
  return result;
}

/**
 * Регистрация Webhook URL в Telegram Bot API
 */
async function setTelegramWebhook(botToken, webhookUrl, secret = process.env.TG_WEBHOOK_SECRET) {
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(secret || '')) throw new Error('webhook_secret_required');
  const url = new URL(webhookUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new Error('explicit_clean_https_webhook_url_required');
  return await sendTelegramRaw(botToken, 'setWebhook', {
    url: webhookUrl,
    secret_token: secret,
    allowed_updates: ['message', 'callback_query']
  });
}

/**
 * Получение текущей информации о Webhook в Telegram
 */
async function getTelegramWebhookInfo(botToken) {
  return await sendTelegramRaw(botToken, 'getWebhookInfo', {});
}

module.exports = {
  sendTelegramLead,
  formatTelegramLead,
  extractAvitoChatId,
  sendTelegramMessage,
  sendTelegramRaw,
  setTelegramWebhook,
  getTelegramWebhookInfo,
  escapeHtml
};


// Provider bodies may contain private data; never propagate JSON parser snippets.
async function safeJson(response) {
  try { return await response.json(); } catch (_) { throw new Error('provider_invalid_json'); }
}
