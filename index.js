/**
 * Точка входа для Yandex Cloud Functions
 * Универсальный обработчик:
 * 1. Webhook от официального API Авито (входящие сообщения покупателей)
 * 2. Webhook от Telegram Bot API (команды продавца + ответы покупателю через Reply)
 */

const { getAccessToken, sendAvitoMessage, checkAvitoConnection } = require('./lib/avito');
const { 
  sendTelegramLead, 
  extractAvitoChatId, 
  sendTelegramMessage, 
  escapeHtml 
} = require('./lib/telegram');

let lastAvitoChatId = null;

module.exports.handler = async function (event, context) {
  // Разрешаем CORS OPTIONS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: 'OK'
    };
  }

  // Парсим тело запроса
  let body;
  try {
    let rawBody = event.body;
    if (event.isBase64Encoded) {
      rawBody = Buffer.from(rawBody, 'base64').toString('utf-8');
    }
    body = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
  } catch (err) {
    console.error('Failed to parse webhook JSON:', err);
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid JSON payload' })
    };
  }

  // Переменные окружения
  const AVITO_CLIENT_ID = process.env.AVITO_CLIENT_ID;
  const AVITO_CLIENT_SECRET = process.env.AVITO_CLIENT_SECRET;
  const AVITO_USER_ID = process.env.AVITO_USER_ID;
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
  const AUTO_REPLY_TEXT = process.env.AUTO_REPLY_TEXT || 
    'Здравствуйте! 👋 Спасибо за обращение. Ваше сообщение принято, мастер/менеджер свяжется с вами в течение 3–5 минут.';
  const AUTO_REPLY_ENABLED = process.env.AUTO_REPLY_ENABLED !== 'false';

  // ===========================================================================
  // ВЕТКА А: Запрос пришел от TELEGRAM BOT API (апдейт от продавца)
  // ===========================================================================
  if (body?.message || body?.callback_query) {
    const tgMsg = body.message;
    if (!tgMsg) {
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    const senderId = String(tgMsg.from?.id || tgMsg.chat?.id || '').trim();
    const configuredChatId = String(TELEGRAM_CHAT_ID || '').trim();

    // Проверка безопасности: обрабатываем команды только от авторизованного владельца
    if (configuredChatId && senderId !== configuredChatId) {
      console.warn(`[SECURITY] Ignored message from unauthorized Telegram user: ${senderId} (configured TELEGRAM_CHAT_ID: ${configuredChatId})`);
      return { statusCode: 200, body: JSON.stringify({ status: 'ignored_unauthorized' }) };
    }

    const text = (tgMsg.text || '').trim();

    // 1. Команда /start
    if (text === '/start') {
      if (TELEGRAM_BOT_TOKEN) {
        await sendTelegramMessage(TELEGRAM_BOT_TOKEN, senderId, [
          '👋 <b>Авито-Перехватчик подключен и активен!</b>',
          '',
          '⚡️ <b>Как это работает:</b>',
          '1. При новом сообщении на Авито бот мгновенно отправит автоответ (<1 сек) для защиты значка «Отвечает за минуту».',
          '2. Вы получите карточку лида в этот чат.',
          '3. <b>Чтобы ответить покупателю:</b> просто сделайте <i>Reply (Ответить)</i> на карточку лида, и ваш текст мгновенно отправится в чат Авито!',
          '',
          '📋 <b>Команды:</b>',
          '• /status — проверка подключения к Авито API',
          '• /help — справка по работе'
        ].join('\n'));
      }

      return { statusCode: 200, body: JSON.stringify({ ok: true, handled: 'tg_start' }) };
    }

    // 2. Команда /status
    if (text === '/status') {
      const statusCheck = await checkAvitoConnection(AVITO_CLIENT_ID, AVITO_CLIENT_SECRET, AVITO_USER_ID);
      const statusText = [
        '📊 <b>Статус интеграции «Авито $\leftrightarrow$ Telegram»:</b>',
        '',
        `🔌 <b>Авито API:</b> ${statusCheck.connected ? '✅ Подключено' : '❌ Ошибка: ' + escapeHtml(statusCheck.error)}`,
        `👤 <b>User ID продавца:</b> <code>${AVITO_USER_ID || 'не задан'}</code>`,
        `🤖 <b>Автоответчик:</b> ${AUTO_REPLY_ENABLED ? '✅ Включен' : '⏸ Отключен'}`,
        `📝 <b>Текст автоответа:</b> «<i>${escapeHtml(AUTO_REPLY_TEXT)}</i>»`,
        '',
        '⚡️ <i>Все входящие диалоги пересылаются в этот чат.</i>'
      ].join('\n');

      if (TELEGRAM_BOT_TOKEN) {
        await sendTelegramMessage(TELEGRAM_BOT_TOKEN, senderId, statusText);
      }
      return { statusCode: 200, body: JSON.stringify({ ok: true, handled: 'tg_status' }) };
    }

    // 3. Команда /help
    if (text === '/help') {
      if (TELEGRAM_BOT_TOKEN) {
        await sendTelegramMessage(TELEGRAM_BOT_TOKEN, senderId, [
          'ℹ️ <b>Инструкция по двустороннему диалогу:</b>',
          '',
          'Когда вам придет уведомление о новом сообщении на Авито, смахните его влево (Reply / Ответить) и напишите ваш ответ.',
          'Бот отправит его в чат Авито покупателю через официальный API.',
          '',
          'Покупатель увидит ваш ответ на Авито, а вы сэкономите время и не будете открывать приложение!'
        ].join('\n'));
      }
      return { statusCode: 200, body: JSON.stringify({ ok: true, handled: 'tg_help' }) };
    }

    // 4. ДВУСТОРОННИЙ ЧАТ: Продавец ответил на карточку лида (через Reply или текстом в активный диалог)
    let avitoChatId = null;
    let isReply = false;

    if (tgMsg.reply_to_message) {
      avitoChatId = extractAvitoChatId(tgMsg.reply_to_message);
      isReply = true;
    } else if (lastAvitoChatId || process.env.ACTIVE_AVITO_CHAT_ID) {
      // Автоматический fallback: продавец просто написал в чат без свайпа Reply
      avitoChatId = lastAvitoChatId || process.env.ACTIVE_AVITO_CHAT_ID;
      isReply = false;
    }

    if (avitoChatId) {
      if (!text) {
        if (TELEGRAM_BOT_TOKEN) {
          await sendTelegramMessage(TELEGRAM_BOT_TOKEN, senderId, 
            '⚠️ <i>Поддерживаются только текстовые сообщения.</i>',
            { reply_to_message_id: tgMsg.message_id }
          );
        }
        return { statusCode: 200, body: JSON.stringify({ ok: true, handled: 'tg_reply_empty_text' }) };
      }

      try {
        const token = await getAccessToken(AVITO_CLIENT_ID, AVITO_CLIENT_SECRET);
        await sendAvitoMessage(token, Number(AVITO_USER_ID), avitoChatId, text);

        if (TELEGRAM_BOT_TOKEN) {
          const successNotice = isReply
            ? `✅ <b>Ответ доставлен покупателю в чат Авито!</b>\n💬 «<i>${escapeHtml(text)}</i>»`
            : `✅ <b>Ответ доставлен покупателю в чат Авито!</b>\n💬 «<i>${escapeHtml(text)}</i>»\n\n💡 <i>Совет: если покупателей будет несколько, отвечайте свайпом (Reply) на конкретную карточку.</i>`;

          await sendTelegramMessage(TELEGRAM_BOT_TOKEN, senderId, successNotice, {
            reply_to_message_id: tgMsg.message_id
          });
        }
        console.log(`[2WAY_REPLY] Successfully forwarded seller reply to Avito chat ${avitoChatId} (isReply: ${isReply})`);
        return { statusCode: 200, body: JSON.stringify({ ok: true, handled: 'tg_2way_reply_sent', chat_id: avitoChatId, is_reply: isReply }) };
      } catch (err) {
        console.error('[2WAY_REPLY_ERROR] Failed to send reply to Avito:', err.message);
        if (TELEGRAM_BOT_TOKEN) {
          await sendTelegramMessage(TELEGRAM_BOT_TOKEN, senderId, 
            `❌ <b>Ошибка отправки в Авито:</b> ${escapeHtml(err.message)}`,
            { reply_to_message_id: tgMsg.message_id }
          );
        }
        return { statusCode: 200, body: JSON.stringify({ ok: false, error: err.message }) };
      }
    }

    // Если нет активного диалога и не использован Reply
    if (text) {
      if (TELEGRAM_BOT_TOKEN) {
        await sendTelegramMessage(TELEGRAM_BOT_TOKEN, senderId, [
          'ℹ️ <b>Не найден активный диалог с покупателем на Авито.</b>',
          '',
          'Чтобы отправить ответ покупателю, пожалуйста, смахните влево карточку лида (Reply / Ответить) и напишите ваш текст.'
        ].join('\n'), { reply_to_message_id: tgMsg.message_id });
      }
      return { statusCode: 200, body: JSON.stringify({ ok: true, handled: 'tg_unrecognized_prompted' }) };
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true, handled: 'tg_unrecognized' }) };
  }

  // ===========================================================================
  // ВЕТКА Б: Запрос пришел от АВИТО MESSENGER API (входящее сообщение)
  // ===========================================================================
  const val = body?.payload?.value || body?.value || body;
  if (!val || !val.id) {
    return {
      statusCode: 200,
      body: JSON.stringify({ status: 'ignored_no_message_id' })
    };
  }

  const authorId = Number(val.author_id);
  const sellerId = Number(AVITO_USER_ID);

  // 1. Защита от бесконечного цикла: если автор сообщения — сам продавец, выходим
  if (sellerId && authorId === sellerId) {
    console.log(`[LOOP_PROTECTION] Ignored message from seller itself (author_id: ${authorId})`);
    return {
      statusCode: 200,
      body: JSON.stringify({ status: 'ignored_self_message' })
    };
  }

  const messageText = val.content?.text || val.text || '';
  const chatId = val.chat_id;
  if (chatId) {
    lastAvitoChatId = chatId;
  }
  const itemTitle = val.item_title || val.item?.title || 'Товар / Услуга на Авито';
  const authorName = val.author_name || `Пользователь #${authorId}`;

  let autoReplySent = false;

  // 2. Отправка мгновенного автоответа покупателю на Авито
  if (AUTO_REPLY_ENABLED && AVITO_CLIENT_ID && AVITO_CLIENT_SECRET && sellerId && chatId) {
    try {
      const token = await getAccessToken(AVITO_CLIENT_ID, AVITO_CLIENT_SECRET);
      await sendAvitoMessage(token, sellerId, chatId, AUTO_REPLY_TEXT);
      autoReplySent = true;
      console.log(`[AUTO_REPLY] Successfully sent auto-reply to Avito chat ${chatId}`);
    } catch (err) {
      console.error('[AUTO_REPLY_ERROR] Failed to send auto-reply to Avito:', err.message);
    }
  }

  // 3. Отправка структурированного пуш-уведомления в Telegram предпринимателю
  if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
    try {
      await sendTelegramLead(TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, {
        itemTitle,
        authorName,
        authorId,
        messageText,
        chatId,
        autoReplySent
      });
      console.log(`[TELEGRAM_NOTIFY] Successfully forwarded lead to Telegram chat ${TELEGRAM_CHAT_ID}`);
    } catch (err) {
      console.error('[TELEGRAM_ERROR] Failed to notify Telegram:', err.message);
    }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ok: true,
      auto_reply_sent: autoReplySent,
      telegram_forwarded: Boolean(TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID)
    })
  };
};
