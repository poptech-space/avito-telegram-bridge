#!/usr/bin/env node
/**
 * Скрипт отправки синтетического вебхука Авито в обработчик
 * Использование:
 *   node scripts/simulate-webhook.js [URL] [Текст вопроса] [Название объявления]
 * 
 * Пример:
 *   node scripts/simulate-webhook.js https://functions.yandexcloud.net/d4e... "Сколько стоит замер?"
 */

const { execSync } = require('child_process');

let targetUrl = process.argv[2];
const messageText = process.argv[3] || 'Здравствуйте! Подскажите стоимость выезда на замер?';
const itemTitle = process.argv[4] || 'Услуги мастера / Ремонт под ключ';

if (!targetUrl) {
  try {
    const raw = execSync('yc serverless function get --name avito-bridge --format json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const fnData = JSON.parse(raw);
    if (fnData?.id) {
      targetUrl = `https://functions.yandexcloud.net/${fnData.id}`;
      console.log(`ℹ️ Найден URL облачной функции: ${targetUrl}`);
    }
  } catch (err) {
    // yc не ответил
  }
}

if (!targetUrl) {
  console.error('❌ Ошибка: Укажите URL назначения:');
  console.error('  node scripts/simulate-webhook.js https://functions.yandexcloud.net/<FUNCTION_ID> [Текст]');
  console.error('  или node scripts/simulate-webhook.js http://localhost:3000 [Текст]');
  process.exit(1);
}

const mockPayload = {
  payload: {
    value: {
      id: `msg_sim_${Date.now()}`,
      chat_id: `u2i-chat-demo-${Date.now().toString(36)}`,
      author_id: 999111222,
      author_name: 'Тестовый Покупатель',
      item_title: itemTitle,
      text: messageText,
      created: Math.floor(Date.now() / 1000)
    }
  }
};

async function send() {
  console.log('==============================================================================');
  console.log('🚀 ОТПРАВКА СИНТЕТИЧЕСКОГО ВЕБХУКА АВИТО');
  console.log('==============================================================================');
  console.log(`🎯 URL:         ${targetUrl}`);
  console.log(`📦 Объявление:  ${itemTitle}`);
  console.log(`👤 Покупатель:  Тестовый Покупатель (ID: 999111222)`);
  console.log(`💬 Вопрос:      «${messageText}»`);
  console.log(`🆔 Chat ID:     ${mockPayload.payload.value.chat_id}`);
  console.log('------------------------------------------------------------------------------');

  const t0 = Date.now();
  try {
    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Avito-Webhook-Simulator/1.0'
      },
      body: JSON.stringify(mockPayload)
    });

    const elapsed = Date.now() - t0;
    const bodyText = await res.text();
    let bodyJson;
    try { bodyJson = JSON.parse(bodyText); } catch (_) {}

    console.log(`✅ Ответ сервера: HTTP ${res.status} (${elapsed} ms)`);
    console.log('📄 Тело ответа:', bodyJson ? JSON.stringify(bodyJson, null, 2) : bodyText);

    if (res.ok) {
      console.log('------------------------------------------------------------------------------');
      console.log('🎉 Вебхук успешно принят обработчиком!');
      console.log('👉 Проверьте ваш Telegram: на телефон должно поступить пуш-сообщение о лиде.');
    } else {
      console.error(`⚠️ Сервер вернул ошибку: HTTP ${res.status}`);
    }
  } catch (err) {
    console.error('❌ Ошибка отправки запроса:', err.message);
    process.exit(1);
  }
}

send();
