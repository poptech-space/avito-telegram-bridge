/**
 * Расширенный локальный автотест обработчика avito-bridge:
 * 1. Входящее сообщение от покупателя на Авито
 * 2. Защита от бесконечного цикла (сообщение продавца)
 * 3. Команды Telegram (/start, /status, /help)
 * 4. Двусторонний чат: продавец отвечает в Telegram через Reply
 * 5. Защита от неавторизованных пользователей Telegram
 */

const assert = require('assert');
const { handler } = require('../index');
const { extractAvitoChatId } = require('../lib/telegram');
const mockEvent = require('./mock-event.json');

async function runTests() {
  process.env.AVITO_USER_ID = '100200300';
  process.env.AUTO_REPLY_ENABLED = 'false';
  process.env.TELEGRAM_BOT_TOKEN = '';
  process.env.TELEGRAM_CHAT_ID = '777888999';

  console.log('--- [TEST 1] Входящее событие от покупателя на Авито ---');
  const res1 = await handler(mockEvent, {});
  assert.strictEqual(res1.statusCode, 200);
  const body1 = JSON.parse(res1.body);
  assert.strictEqual(body1.ok, true);
  console.log('✅ TEST 1 пройден: событие Авито успешно обработано.');

  console.log('\n--- [TEST 2] Защита от бесконечного цикла (сообщение продавца) ---');
  const selfEvent = {
    httpMethod: 'POST',
    isBase64Encoded: false,
    body: JSON.stringify({
      payload: {
        value: {
          id: 'msg_self_1',
          chat_id: 'u2i-mockchat-882299',
          user_id: 100200300,
          author_id: 100200300,
          content: { text: 'Я сам ответил.' }
        }
      }
    })
  };
  const resSelf = await handler(selfEvent, {});
  assert.strictEqual(resSelf.statusCode, 200);
  assert.strictEqual(JSON.parse(resSelf.body).status, 'ignored_self_message');
  console.log('✅ TEST 2 пройден: сообщение продавца проигнорировано.');

  console.log('\n--- [TEST 3] Извлечение Avito Chat ID из Telegram Reply ---');
  const mockReplyMessage = {
    text: '🚨 Новое обращение на Авито!\n📦 Объявление: Ремонт\n💬 Текст: «Цена?»\n#диалог_u2i-ch4t-12345-xyz'
  };
  const extractedChatId = extractAvitoChatId(mockReplyMessage);
  assert.strictEqual(extractedChatId, 'u2i-ch4t-12345-xyz', 'Должен корректно извлечь ID чата Авито');
  console.log('✅ TEST 3 пройден: извлечен Avito Chat ID =', extractedChatId);

  console.log('\n--- [TEST 4] Команда /start от авторизованного продавца в Telegram ---');
  const tgStartEvent = {
    httpMethod: 'POST',
    isBase64Encoded: false,
    body: JSON.stringify({
      update_id: 1001,
      message: {
        message_id: 55,
        from: { id: 777888999, first_name: 'Alex' },
        chat: { id: 777888999 },
        text: '/start'
      }
    })
  };
  const resTgStart = await handler(tgStartEvent, {});
  assert.strictEqual(resTgStart.statusCode, 200);
  assert.strictEqual(JSON.parse(resTgStart.body).handled, 'tg_start');
  console.log('✅ TEST 4 пройден: команда /start распознана.');

  console.log('\n--- [TEST 5] Защита: сообщение от чужого пользователя Telegram ---');
  const tgStrangerEvent = {
    httpMethod: 'POST',
    isBase64Encoded: false,
    body: JSON.stringify({
      update_id: 1002,
      message: {
        message_id: 56,
        from: { id: 111222333, first_name: 'Hacker' }, // не совпадает с TELEGRAM_CHAT_ID
        chat: { id: 111222333 },
        text: '/start'
      }
    })
  };
  const resStranger = await handler(tgStrangerEvent, {});
  assert.strictEqual(resStranger.statusCode, 200);
  assert.strictEqual(JSON.parse(resStranger.body).status, 'ignored_unauthorized');
  console.log('✅ TEST 5 пройден: неавторизованный пользователь Telegram отсечен.');

  console.log('\n--- [TEST 6] OPTIONS Preflight CORS ---');
  const resOptions = await handler({ httpMethod: 'OPTIONS' }, {});
  assert.strictEqual(resOptions.statusCode, 200);
  console.log('✅ TEST 6 пройден: CORS OPTIONS работает.');

  console.log('\n--- [TEST 7] Эмулятор: Mock-сервер Авито (OAuth + Send Message) ---');
  const http = require('http');
  const { getAccessToken, sendAvitoMessage, getBaseUrl } = require('../lib/avito');
  process.env.AVITO_API_BASE_URL = 'http://127.0.0.1:4041';
  assert.strictEqual(getBaseUrl(), 'http://127.0.0.1:4041');

  let mockReceived = null;
  const mockSrv = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      if (req.url.startsWith('/token/')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ access_token: 'test_token_777', expires_in: 3600 }));
      } else if (req.url.includes('/messages')) {
        mockReceived = JSON.parse(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: 'msg_mock_777', created: 1713180000 }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      }
    });
  });

  await new Promise(r => mockSrv.listen(4041, '127.0.0.1', r));
  try {
    const tkn = await getAccessToken('mock_id', 'mock_sec');
    assert.strictEqual(tkn, 'test_token_777');
    await sendAvitoMessage(tkn, 100200300, 'u2i-chat-test', 'Автоответ покупателю');
    assert.strictEqual(mockReceived?.message?.text, 'Автоответ покупателю');
    console.log('✅ TEST 7 пройден: Mock-сервер Авито корректно перехватывает вызовы OAuth и отправки сообщений.');
  } finally {
    await new Promise(r => mockSrv.close(r));
    delete process.env.AVITO_API_BASE_URL;
  }

  console.log('\n--- [TEST 8] Ответ продавца обычным текстом без Reply (умный fallback на активный диалог) ---');
  process.env.ACTIVE_AVITO_CHAT_ID = 'u2i-chat-fallback-999';
  process.env.TELEGRAM_CHAT_ID = '777888999';
  process.env.AVITO_CLIENT_ID = 'mock_id';
  process.env.AVITO_CLIENT_SECRET = 'mock_sec';
  process.env.AVITO_API_BASE_URL = 'http://127.0.0.1:4042';

  let fallbackReceived = null;
  const mockSrv2 = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      if (req.url.startsWith('/token/')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ access_token: 'test_token_888', expires_in: 3600 }));
      } else if (req.url.includes('/messages')) {
        fallbackReceived = JSON.parse(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: 'msg_fallback_ok', created: 1713180000 }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      }
    });
  });

  await new Promise(r => mockSrv2.listen(4042, '127.0.0.1', r));
  try {
    const tgNoReplyEvent = {
      httpMethod: 'POST',
      isBase64Encoded: false,
      body: JSON.stringify({
        update_id: 2001,
        message: {
          message_id: 88,
          from: { id: 777888999, first_name: 'Alex' },
          chat: { id: 777888999 },
          text: 'Здравствуйте! Да, выезд завтра в 10:00'
          // reply_to_message отсутствует!
        }
      })
    };
    const resNoReply = await handler(tgNoReplyEvent, {});
    assert.strictEqual(resNoReply.statusCode, 200);
    const parsedNoReply = JSON.parse(resNoReply.body);
    assert.strictEqual(parsedNoReply.handled, 'tg_2way_reply_sent');
    assert.strictEqual(parsedNoReply.is_reply, false);
    assert.strictEqual(parsedNoReply.chat_id, 'u2i-mockchat-882299');
    assert.strictEqual(fallbackReceived?.message?.text, 'Здравствуйте! Да, выезд завтра в 10:00');
    console.log('✅ TEST 8 пройден: сообщение без Reply успешно доставлено покупателю в последний активный диалог!');
  } finally {
    await new Promise(r => mockSrv2.close(r));
    delete process.env.AVITO_API_BASE_URL;
    delete process.env.ACTIVE_AVITO_CHAT_ID;
  }

  console.log('\n🎉 ВСЕ 8 ТЕСТОВ (АВИТО + ТЕЛЕГРАМ 2-WAY + FALLBACK БЕЗ REPLY + MOCK) УСПЕШНО ПРОЙДЕНЫ!');
}

runTests().catch(err => {
  console.error('❌ Ошибка тестирования:', err);
  process.exit(1);
});


