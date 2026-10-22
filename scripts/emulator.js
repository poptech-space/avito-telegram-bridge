#!/usr/bin/env node
/**
 * Интерактивный эмулятор Авито API и Telegram-коннектора
 * 
 * Позволяет провести полноценное сквозное тестирование на реальном телефоне
 * без доступа к официальному кабинету Авито API.
 * 
 * Что делает:
 * 1. Запускает локальный Mock HTTP-сервер Avito API (порт 4040).
 * 2. Запускает Telegram Long-Polling (слушает команды и Reply-ответы с вашего телефона).
 * 3. Открывает интерактивный CLI: вы отправляете вопросы как покупатель на Авито,
 *    получаете пуш в Telegram на телефон, делаете Reply и видите ответ в консоли.
 */

const http = require('http');
const readline = require('readline');
const { loadEnv } = require('../lib/env-loader');
const { handler } = require('../index');

// 1. Загрузка переменных окружения
loadEnv();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!BOT_TOKEN || !CHAT_ID) {
  console.log('==============================================================================');
  console.log('⚠️  НЕ ЗАДАНЫ TELEGRAM_BOT_TOKEN ИЛИ TELEGRAM_CHAT_ID');
  console.log('==============================================================================');
  console.log('Для живого теста на телефоне требуются только эти 2 параметра.');
  console.log('Создайте файл .env со следующими строками:');
  console.log('');
  console.log('  TELEGRAM_BOT_TOKEN=123456789:ABC_def...');
  console.log('  TELEGRAM_CHAT_ID=987654321');
  console.log('');
  console.log('Получить токен: @BotFather в Telegram');
  console.log('Узнать ваш ID:  @userinfobot или @getmyid_bot в Telegram');
  console.log('==============================================================================');
  process.exit(1);
}

// Устанавливаем фиктивные параметры Авито и перенаправляем API на локальный порт 4040
const MOCK_PORT = 4040;
process.env.AVITO_API_BASE_URL = `http://127.0.0.1:${MOCK_PORT}`;
process.env.AVITO_CLIENT_ID = process.env.AVITO_CLIENT_ID || 'mock_avito_client_id';
process.env.AVITO_CLIENT_SECRET = process.env.AVITO_CLIENT_SECRET || 'mock_avito_secret';
process.env.AVITO_USER_ID = process.env.AVITO_USER_ID || '100200300';
process.env.AUTO_REPLY_ENABLED = process.env.AUTO_REPLY_ENABLED || 'true';

let activeChatId = `u2i-chat-demo-${Date.now().toString(36)}`;
process.env.ACTIVE_AVITO_CHAT_ID = activeChatId;
let mockServer;
let isPolling = true;
let pollOffset = 0;
let rl;

// 2. Локальный Mock-сервер Авито (порт 4040)
function startMockAvitoServer() {
  return new Promise((resolve, reject) => {
    mockServer = http.createServer(async (req, res) => {
      const url = req.url || '';
      let reqBody = '';
      req.on('data', chunk => { reqBody += chunk; });
      req.on('end', () => {
        let parsed = {};
        try { parsed = JSON.parse(reqBody); } catch (_) {}

        // Mock OAuth 2.0 Token
        if (url.startsWith('/token/')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            access_token: `mock_token_${Date.now()}`,
            token_type: 'Bearer',
            expires_in: 86400
          }));
          return;
        }

        // Mock Send Message to Buyer
        if (url.includes('/messages')) {
          const sentText = parsed?.message?.text || '(пусто)';
          const isAutoReply = sentText.includes('Здравствуйте!') && sentText.includes('принято');

          console.log('');
          if (isAutoReply) {
            console.log(`⚡️ [MOCK АВИТО] ПОКУПАТЕЛЬ ПОЛУЧИЛ АВТООТВЕТ:`);
            console.log(`   «${sentText}»`);
          } else {
            console.log(`🎉 [MOCK АВИТО] ПОКУПАТЕЛЬ ПОЛУЧИЛ ОТВЕТ ОТ ПРОДАВЦА ИЗ TELEGRAM:`);
            console.log(`   💬 «${sentText}»`);
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            id: `msg_mock_${Date.now()}`,
            created: Math.floor(Date.now() / 1000)
          }));
          return;
        }

        // Mock Webhook subscription
        if (url.includes('/webhook')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    });

    mockServer.listen(MOCK_PORT, '127.0.0.1', () => {
      resolve();
    });

    mockServer.on('error', (err) => {
      reject(err);
    });
  });
}

// 3. Telegram Poller (слушает команды и ответы продавца)
async function startTelegramPoller() {
  // Сбрасываем webhook у бота, чтобы getUpdates работал корректно
  try {
    const delRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ drop_pending_updates: false })
    });
    const delData = await delRes.json();
    if (delData.ok) {
      console.log('📡 [TELEGRAM] Webhook сброшен, Telegram Poller готов к приёму сообщений.');
    } else {
      console.warn('⚠️ [TELEGRAM] deleteWebhook сообщил:', delData.description);
    }
  } catch (err) {
    console.warn('⚠️ [TELEGRAM] Ошибка вызова deleteWebhook:', err.message);
  }

  // Цикл long-polling
  (async () => {
    while (isPolling) {
      try {
        const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${pollOffset}&timeout=4`, {
          method: 'GET'
        });
        if (!res.ok) {
          const errText = await res.text();
          console.error(`❌ [TELEGRAM POLLER] Ошибка HTTP ${res.status}: ${errText}`);
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }
        const data = await res.json();
        if (data.ok && Array.isArray(data.result)) {
          for (const update of data.result) {
            pollOffset = update.update_id + 1;
            if (update.message) {
              const fromName = update.message.from?.first_name || 'Пользователь';
              const fromId = update.message.from?.id;
              const msgText = update.message.text || '';
              const isReply = Boolean(update.message.reply_to_message);

              console.log(`\n📨 [TELEGRAM ВХОДЯЩЕЕ] От: ${fromName} (ID: ${fromId}) | Reply: ${isReply ? 'ДА (цитирование)' : 'НЕТ (обычный текст)'}`);
              console.log(`   💬 Текст: «${msgText}»`);

              // Эмулируем вызов YCF Handler
              const event = {
                httpMethod: 'POST',
                headers: { 'content-type': 'application/json' },
                body: update,
                isBase64Encoded: false
              };
              const handlerRes = await handler(event, {});
              let resultObj = {};
              try { resultObj = JSON.parse(handlerRes.body); } catch (_) {}
              console.log(`   ⚙️ Коннектор:`, resultObj);
            }
          }
        }
      } catch (err) {
        console.error('❌ [TELEGRAM POLLER] Ошибка сети:', err.message);
      }
      if (isPolling) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  })();
}

// 4. Отправка вопроса от лица покупателя
async function sendBuyerMessage(text, itemTitle = 'Ремонт и отделка квартир под ключ') {
  console.log('------------------------------------------------------------------------------');
  console.log(`👤 [ПОКУПАТЕЛЬ НА АВИТО] Отправка вопроса в чат:`);
  console.log(`   📦 Объявление: ${itemTitle}`);
  console.log(`   💬 Текст:      «${text}»`);
  console.log(`   🆔 Диалог:     ${activeChatId}`);
  console.log('------------------------------------------------------------------------------');

  const event = {
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json' },
    body: {
      payload: {
        value: {
          id: `msg_${Date.now()}`,
          chat_id: activeChatId,
          author_id: 999888777,
          author_name: 'Иван (Покупатель)',
          item_title: itemTitle,
          text: text,
          created: Math.floor(Date.now() / 1000)
        }
      }
    },
    isBase64Encoded: false
  };

  const t0 = Date.now();
  await handler(event, {});
  const elapsed = Date.now() - t0;

  console.log(`✅ [КОННЕКТОР] Обработано за ${elapsed} ms: автоответ инициирован, пуш отправлен в Telegram.`);
  console.log('👉 Теперь проверьте телефон! Сделайте Reply на карточку лида, чтобы ответить покупателю.');
  console.log('');
}

// 5. Консольное меню управления
function showMenu() {
  console.log('');
  console.log('==============================================================================');
  console.log('🛎  ВЫБЕРИТЕ ДЕЙСТВИЕ (ОТ ЛИЦА ПОКУПАТЕЛЯ АВИТО):');
  console.log('==============================================================================');
  console.log('1. [Вопрос по цене]    «Здравствуйте! Сколько стоит ремонт кухни 12 кв.м?»');
  console.log('2. [Срочный заказ]     «Добрый день! Нужен мастер сегодня на 18:00, успеете?»');
  console.log('3. [Скидка/сроки]      «Здравствуйте! Объявление актуально? Скидку сделаете?»');
  console.log('4. Ввести свой вопрос вручную');
  console.log('n. Начать НОВЫЙ диалог (сменить chat_id)');
  console.log('q. Выход');
  console.log('------------------------------------------------------------------------------');
  rl.question('👉 Ваш выбор (1-4, n, q): ', handleChoice);
}

async function handleChoice(input) {
  const choice = input.trim();

  if (choice === 'q' || choice === 'exit') {
    shutdown();
    return;
  }

  if (choice === 'n') {
    activeChatId = `u2i-chat-demo-${Date.now().toString(36)}`;
    process.env.ACTIVE_AVITO_CHAT_ID = activeChatId;
    console.log(`🔄 Создан новый диалог: ${activeChatId}`);
    showMenu();
    return;
  }

  if (choice === '1') {
    await sendBuyerMessage('Здравствуйте! Сколько стоит ремонт кухни 12 кв.м?');
    showMenu();
    return;
  }

  if (choice === '2') {
    await sendBuyerMessage('Добрый день! Нужен мастер сегодня на 18:00, успеете?');
    showMenu();
    return;
  }

  if (choice === '3') {
    await sendBuyerMessage('Здравствуйте! Объявление актуально? Скидку сделаете при оплате сегодня?');
    showMenu();
    return;
  }

  if (choice === '4') {
    rl.question('✍️ Введите текст вопроса покупателя: ', async (customText) => {
      const txt = customText.trim() || 'Здравствуйте! Подскажите подробнее условия?';
      await sendBuyerMessage(txt);
      showMenu();
    });
    return;
  }

  console.log('⚠️ Неизвестная команда. Введите 1, 2, 3, 4, n или q.');
  showMenu();
}

function shutdown() {
  console.log('\n🛑 Остановка эмулятора...');
  isPolling = false;
  if (mockServer) mockServer.close();
  if (rl) rl.close();
  console.log('👋 Эмулятор остановлен.');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Точка входа
async function main() {
  try {
    await startMockAvitoServer();
  } catch (err) {
    console.error(`❌ Ошибка запуска Mock-сервера Авито на порту ${MOCK_PORT}:`, err.message);
    process.exit(1);
  }

  await startTelegramPoller();

  console.log('==============================================================================');
  console.log('🎉 ЭМУЛЯТОР АВИТО-ПЕРЕХВАТЧИКА ЗАПУЩЕН И ГОТОВ К ТЕСТИРОВАНИЮ!');
  console.log('==============================================================================');
  console.log(`🤖 Telegram Bot:       Токен загружен (${BOT_TOKEN.slice(0, 10)}...)`);
  console.log(`👤 Владелец бота:      Chat ID: ${CHAT_ID}`);
  console.log(`🌐 Mock Avito API:     http://127.0.0.1:${MOCK_PORT} (активен)`);
  console.log(`📡 Telegram Poller:    Слушает ответы с вашего телефона в реальном времени`);
  console.log('==============================================================================');
  console.log('💡 СОВЕТ: Откройте Telegram на телефоне. Когда вы выберете вопрос ниже,');
  console.log('бот пришлет вам карточку лида. Ответьте на нее через Reply!');

  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  showMenu();
}

main();
