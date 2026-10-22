#!/usr/bin/env node
/**
 * Скрипт регистрации Webhook в Telegram Bot API
 * Использование:
 *   node scripts/register-telegram-webhook.js [URL]
 * Если URL не передан, скрипт попытается определить его через yc CLI.
 */

const { execSync } = require('child_process');
const { loadEnv } = require('../lib/env-loader');
const { setTelegramWebhook, getTelegramWebhookInfo } = require('../lib/telegram');

loadEnv();

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('❌ Ошибка: Не задана переменная TELEGRAM_BOT_TOKEN в .env');
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
  console.error('  node scripts/register-telegram-webhook.js https://functions.yandexcloud.net/<FUNCTION_ID>');
  process.exit(1);
}

async function main() {
  console.log(`📡 Регистрация Telegram Webhook на адрес:\n   ${webhookUrl}...`);
  try {
    const res = await setTelegramWebhook(token, webhookUrl);
    console.log('✅ Результат установки Webhook в Telegram:', res);

    console.log('🔍 Проверка статуса (getWebhookInfo)...');
    const info = await getTelegramWebhookInfo(token);
    console.log('📊 Статус Telegram Webhook:', JSON.stringify(info.result, null, 2));
  } catch (err) {
    console.error('❌ Ошибка при регистрации Webhook в Telegram:', err.message);
    process.exit(1);
  }
}

main();
