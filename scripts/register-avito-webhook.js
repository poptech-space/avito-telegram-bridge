#!/usr/bin/env node
/**
 * Скрипт регистрации Webhook в Avito Messenger API
 * Использование:
 *   node scripts/register-avito-webhook.js [URL]
 * Только явный проверенный HTTPS URL; capability берётся из окружения.
 */

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

if (!webhookUrl) { console.error('Explicit verified HTTPS webhook URL required; no implicit yc account lookup.'); process.exit(1); }

async function main() {
  const secret = process.env.AVITO_WEBHOOK_SECRET;
  if (!secret || secret.length < 32) throw new Error('AVITO_WEBHOOK_SECRET must contain at least 32 random characters');
  const target = new URL(webhookUrl);
  if (target.protocol !== 'https:' || target.username || target.password || target.search || target.hash)
    throw new Error('clean_https_url_required');
  target.searchParams.set('avito_secret', secret);
  console.log('🔑 Авторизация в Avito API (получение токена)...');
  try {
    const token = await getAccessToken(clientId, clientSecret);
    console.log('✅ Токен Avito успешно получен.');

    console.log('Регистрация Avito webhook (URL скрыт)');
    const res = await registerAvitoWebhook(token, target.toString());
    console.log('Webhook registration completed; inspect provider status separately.');
  } catch (err) {
    console.error('Webhook registration outcome unknown; inspect provider before retry.');
    process.exit(1);
  }
}

main().catch(() => { console.error('Webhook registration refused or failed'); process.exitCode = 1; });
