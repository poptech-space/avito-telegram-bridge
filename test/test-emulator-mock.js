/**
 * Тест Mock-сервера Авито и отправки сообщений через эмулятор
 */
const http = require('http');
const { getAccessToken, sendAvitoMessage } = require('../lib/avito');

async function testMockServer() {
  console.log('--- [TEST MOCK] Запуск локального mock-сервера Авито на порту 4040 ---');
  process.env.AVITO_API_BASE_URL = 'http://127.0.0.1:4040';

  let lastReceivedMessage = null;

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let parsed = {};
      try { parsed = JSON.parse(body); } catch (_) {}

      if (req.url.startsWith('/token/')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ access_token: 'mock_token_test_123', expires_in: 3600 }));
        return;
      }

      if (req.url.includes('/messages')) {
        lastReceivedMessage = parsed;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: 'msg_test_ok', created: 1713180000 }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });

  await new Promise(resolve => server.listen(4040, '127.0.0.1', resolve));
  console.log('✅ Mock-сервер слушает http://127.0.0.1:4040');

  try {
    // 1. Тест получения токена
    const token = await getAccessToken('test_client_id', 'test_secret');
    if (token !== 'mock_token_test_123') {
      throw new Error(`Неверный токен: ${token}`);
    }
    console.log('✅ Mock-токен успешно получен:', token);

    // 2. Тест отправки сообщения покупателю в чат
    const sendResult = await sendAvitoMessage(token, 100200300, 'u2i-chat-test-456', 'Привет от продавца!');
    if (!lastReceivedMessage || lastReceivedMessage.message?.text !== 'Привет от продавца!') {
      throw new Error(`Сообщение не получено сервером: ${JSON.stringify(lastReceivedMessage)}`);
    }
    console.log('✅ Mock-сообщение успешно доставлено на сервер:', lastReceivedMessage.message.text);
    console.log('🎉 ТЕСТ MOCK-СЕРВЕРА АВИТО УСПЕШНО ПРОЙДЕН!');
  } finally {
    await new Promise(resolve => server.close(resolve));
    console.log('✅ Mock-сервер остановлен.');
  }
}

testMockServer().catch(err => {
  console.error('❌ Ошибка теста mock-сервера:', err.message);
  process.exit(1);
});
