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
async function sendTelegramLead(botToken, chatId, leadData) {
  const {
    itemTitle = 'Товар / Услуга',
    authorName = 'Клиент',
    authorId = '',
    messageText = '',
    chatId: avitoChatId = '',
    autoReplySent = true
  } = leadData;

  const directAvitoUrl = avitoChatId 
    ? `https://www.avito.ru/profile/messenger/channel/${avitoChatId}`
    : 'https://www.avito.ru/profile/messenger';

  const textLines = [
    '🚨 <b>Новое обращение на Авито!</b>',
    '',
    `📦 <b>Объявление:</b> ${escapeHtml(itemTitle)}`,
    `👤 <b>Покупатель:</b> ${escapeHtml(authorName)} (ID: <code>${authorId}</code>)`,
    `💬 <b>Текст:</b> «<i>${escapeHtml(messageText)}</i>»`,
    '',
    autoReplySent 
      ? '⚡️ <i>Автоответ отправлен: значок «Отвечает за минуту» защищен!</i>'
      : '⚠️ <i>Автоответ отключен в настройках.</i>',
    '',
    '✍️ <i>Ответьте на это сообщение (Reply), чтобы отправить ответ покупателю в чат Авито:</i>',
    `<code>#диалог_${escapeHtml(avitoChatId)}</code>`
  ];

  const payload = {
    chat_id: chatId,
    text: textLines.join('\n'),
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: '💬 Открыть диалог на Авито',
            url: directAvitoUrl
          }
        ]
      ]
    }
  };

  return await sendTelegramRaw(botToken, 'sendMessage', payload);
}

/**
 * Извлечение ID чата Авито из цитируемого сообщения (Reply)
 */
function extractAvitoChatId(replyToMessage) {
  if (!replyToMessage) return null;
  const text = replyToMessage.text || replyToMessage.caption || '';
  
  // Ищем #диалог_u2i-... или #диалог_...
  const match = text.match(/#диалог_([a-zA-Z0-9_\-]+)/);
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
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Telegram ${method} failed [${res.status}]: ${errorText}`);
  }

  return await res.json();
}

/**
 * Регистрация Webhook URL в Telegram Bot API
 */
async function setTelegramWebhook(botToken, webhookUrl) {
  return await sendTelegramRaw(botToken, 'setWebhook', {
    url: webhookUrl,
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
  extractAvitoChatId,
  sendTelegramMessage,
  sendTelegramRaw,
  setTelegramWebhook,
  getTelegramWebhookInfo,
  escapeHtml
};

