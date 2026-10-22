#!/usr/bin/env node
/**
 * Скрипт проверки работоспособности развернутой YCF функции
 * Использование:
 *   node scripts/test-live-ping.js [URL]
 */

const { execSync } = require('child_process');

let webhookUrl = process.argv[2];

if (!webhookUrl) {
  try {
    const raw = execSync('yc serverless function get --name avito-bridge --format json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const fnData = JSON.parse(raw);
    if (fnData?.id) {
      webhookUrl = `https://functions.yandexcloud.net/${fnData.id}`;
      console.log(`ℹ️ Найден URL функции: ${webhookUrl}`);
    }
  } catch (err) {
    // yc не ответил
  }
}

if (!webhookUrl) {
  console.error('❌ Ошибка: Укажите URL функции:');
  console.error('  node scripts/test-live-ping.js https://functions.yandexcloud.net/<FUNCTION_ID>');
  process.exit(1);
}

async function ping() {
  console.log(`📡 Отправка тестового OPTIONS запроса (CORS preflight)...`);
  const t0 = Date.now();
  const resOptions = await fetch(webhookUrl, { method: 'OPTIONS' });
  const t1 = Date.now();
  console.log(`✅ OPTIONS ответ: HTTP ${resOptions.status} (${t1 - t0} ms)`);

  console.log(`📡 Отправка тестового POST запроса (пустой payload)...`);
  const t2 = Date.now();
  const resPost = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ping: true })
  });
  const t3 = Date.now();
  const postBody = await resPost.text();
  console.log(`✅ POST ответ: HTTP ${resPost.status} (${t3 - t2} ms): ${postBody}`);

  console.log('🎉 Функция активна и отвечает корректно!');
}

ping().catch(err => {
  console.error('❌ Ошибка проверки функции:', err.message);
  process.exit(1);
});
