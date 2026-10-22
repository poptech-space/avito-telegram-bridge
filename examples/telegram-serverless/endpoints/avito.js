/**
 * Нативный Telegram Serverless HTTP Endpoint для вебхуков Авито
 * Спецификация: https://core.telegram.org/bots/serverless
 * 
 * Файл размещается в: endpoints/avito.js
 * Вызывается внешним сервисом (Авито) по адресу:
 * https://<your-bot-subdomain>.tgcloud.io/endpoints/avito
 */

import { bot } from 'sdk/bot';
import { table } from 'sdk/db';

// Встроенная SQLite таблица для сохранения истории диалогов
const chats = table('avito_chats', {
  chat_id: 'text',
  user_name: 'text',
  item_title: 'text',
  last_updated: 'number',
});

export default async function (request) {
  // 1. Принимаем только POST запросы от Авито
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const payload = await request.json();

    // 2. Валидация события от Авито Messenger API
    const eventType = payload.payload?.type || payload.type;
    const value = payload.payload?.value || payload.value;

    if (!value || eventType !== 'message') {
      return new Response(JSON.stringify({ status: 'ignored' }), { status: 200 });
    }

    const sellerUserId = Number(process.env.AVITO_USER_ID);
    const authorId = Number(value.author_id);

    // Защита от бесконечного цикла (игнорируем собственные сообщения продавца)
    if (authorId === sellerUserId) {
      return new Response(JSON.stringify({ status: 'self_message_ignored' }), { status: 200 });
    }

    const avitoChatId = value.chat_id;
    const authorName = value.author_name || 'Покупатель';
    const messageText = value.content?.text || '[Вложение или фото]';
    const itemTitle = value.item_title || 'Объявление на Авито';
    const targetTelegramChatId = process.env.TELEGRAM_CHAT_ID;

    // 3. Сохраняем связку диалога во встроенную SQLite базу
    chats.set(avitoChatId, {
      chat_id: avitoChatId,
      user_name: authorName,
      item_title: itemTitle,
      last_updated: Date.now(),
    });

    // 4. Формируем сообщение и отправляем продавцу в Telegram
    const notificationText = [
      `🔔 *Новое сообщение на Авито*`,
      `📦 *Товар:* ${itemTitle}`,
      `👤 *От:* ${authorName}`,
      ``,
      `💬 *Текст:* ${messageText}`,
      ``,
      `_Ответьте на это сообщение (Reply), чтобы отправить ответ покупателю в чат Авито._`,
    ].join('\n');

    await bot.api.sendMessage(targetTelegramChatId, notificationText, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: '💬 Открыть на Авито',
              url: `https://www.avito.ru/profile/messenger/channel/${avitoChatId}`,
            },
          ],
        ],
      },
    });

    return new Response(JSON.stringify({ status: 'ok', pushed: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Ошибка обработки вебхука Авито в Telegram Serverless:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
