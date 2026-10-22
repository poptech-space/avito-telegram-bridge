#!/usr/bin/env node
/**
 * Скрипт регистрации Webhook в Avito Messenger API
 * Использование:
 *   node scripts/register-avito-webhook.js [URL]
 * Если URL не передан, скрипт попытается определить его через yc CLI.
 */

const { execSync } = require('child_process');
const { loadEnv } = require('../lib/env-loader');
const { getAccessToken, registerAvitoWebhook } = require('../lib/avito');

loadEnv();

const clientId = process.env.AVITO_CLIENT_ID;
const clientSecret = process.env.AVITO_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error('❌ Ошибка: Не заданы AVITO_CLIENT_ID и/или AVITO_CLIENT_SECRET в .env');
  process.exit(1);
}

let webhookUrl = process.argv[2];

if (!webhookUrl) {
  try {
    const raw = execSync('yc serverless function get --name avito-bridge --format json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const fnData = JSON.parse(raw);
    if (fnData?.id) {
      webhookUrl = `https://functions.yandexcloud.net/${fnData.id}`;
      console.log(`ℹ️ Найден URL функции в Yandex Cloud: ${webhookUrl}`);
    }
  } catch (err) {
    // yc не ответил или функция не создана
  }
}

if (!webhookUrl) {
  console.error('❌ Ошибка: Укажите URL функции:');
  console.error('  node scripts/register-avito-webhook.js https://functions.yandexcloud.net/<FUNCTION_ID>');
  process.exit(1);
}

async function main() {
  console.log('🔑 Авторизация в Avito API (получение токена)...');
  try {
    const token = await getAccessToken(clientId, clientSecret);
    console.log('✅ Токен Avito успешно получен.');

    console.log(`📡 Регистрация Avito Webhook на адрес:\n   ${webhookUrl}...`);
    const res = await registerAvitoWebhook(token, webhookUrl);
    console.log('✅ Результат установки Webhook в Авито:', res);
  } catch (err) {
    console.error('❌ Ошибка при регистрации Webhook в Авито:', err.message);
    process.exit(1);
  }
}

main();
