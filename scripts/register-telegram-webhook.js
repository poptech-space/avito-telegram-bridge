#!/usr/bin/env node
/**
 * Скрипт регистрации Webhook в Telegram Bot API
 * Использование:
 *   node scripts/register-telegram-webhook.js [URL]
 * Только явный проверенный HTTPS URL; облачный аккаунт автоматически не выбирается.
 */

const { loadEnv } = require('../lib/env-loader');
const { setTelegramWebhook, getTelegramWebhookInfo } = require('../lib/telegram');

loadEnv();

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('❌ Ошибка: Не задана переменная TELEGRAM_BOT_TOKEN в .env');
  process.exit(1);
}

let webhookUrl = process.argv[2];

if (!webhookUrl || !webhookUrl.startsWith('https://')) { console.error('Explicit verified HTTPS webhook URL required'); process.exit(1); }

async function main() {
  console.log('Регистрация Telegram webhook');
  try {
    const res = await setTelegramWebhook(token, webhookUrl);
    console.log('Telegram registration completed; verifying status.');

    console.log('🔍 Проверка статуса (getWebhookInfo)...');
    const info = await getTelegramWebhookInfo(token);
    console.log('📊 Статус Telegram Webhook:', JSON.stringify({ pending_update_count: info.result?.pending_update_count, configured: Boolean(info.result?.url) }));
  } catch (err) {
    console.error('Telegram registration outcome unknown; inspect provider before retry.');
    process.exit(1);
  }
}

main();
