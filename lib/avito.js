/**
 * Модуль взаимодействия с официальным Avito Messenger API
 * Документация: https://api.avito.ru/
 */

let cachedToken = null;
let tokenExpiresAt = 0;
let cachedCredentials;
const { createHash } = require('node:crypto');

function getBaseUrl() {
  return process.env.AVITO_API_BASE_URL || 'https://api.avito.ru';
}

/**
 * Получение токена доступа OAuth 2.0 (Client Credentials)
 */
async function getAccessToken(clientId, clientSecret) {
  if (!clientId || !clientSecret) throw new Error('avito_credentials_required');
  const credentials = createHash('sha256').update(JSON.stringify([getBaseUrl(), clientId, clientSecret])).digest('hex');
  const now = Math.floor(Date.now() / 1000);
  if (cachedCredentials === credentials && cachedToken && tokenExpiresAt > now + 60) {
    return cachedToken;
  }

  const params = new URLSearchParams();
  params.append('grant_type', 'client_credentials');
  params.append('client_id', clientId);
  params.append('client_secret', clientSecret);

  const res = await fetch(`${getBaseUrl()}/token/`, {
    signal: AbortSignal.timeout(5000),
    redirect: 'error',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });

  if (!res.ok) {
    const error = new Error('avito_auth_failed'); error.status = res.status; throw error;
  }

  const data = await safeJson(res);
  if (typeof data.access_token !== 'string' || !data.access_token ||
      !Number.isFinite(data.expires_in) || data.expires_in <= 0) throw new Error('avito_auth_invalid_response');
  cachedToken = data.access_token;
  cachedCredentials = credentials;
  tokenExpiresAt = now + data.expires_in;
  return cachedToken;
}

/**
 * Отправка сообщения покупателю в чат Авито
 */
async function sendAvitoMessage(token, userId, chatId, text) {
  const url = `${getBaseUrl()}/messenger/v1/accounts/${userId}/chats/${chatId}/messages`;
  
  const res = await fetch(url, {
    signal: AbortSignal.timeout(5000),
    redirect: 'error',
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message: {
        text: text
      },
      type: 'text'
    })
  });

  if (!res.ok) {
    const error = new Error('avito_rejected_or_unavailable'); error.status = res.status; throw error;
  }

  return await safeJson(res);
}

/**
 * Проверка валидности подключения к Avito API
 */
async function checkAvitoConnection(clientId, clientSecret, userId) {
  try {
    const token = await getAccessToken(clientId, clientSecret);
    return {
      connected: true,
      has_token: Boolean(token),
      user_id: userId
    };
  } catch (err) {
    return {
      connected: false,
      error: err.message
    };
  }
}

/**
 * Регистрация Webhook URL в Avito Messenger API
 * Документация: https://api.avito.ru/
 */
async function registerAvitoWebhook(token, webhookUrl) {
  const res = await fetch(`${getBaseUrl()}/messenger/v3/webhook`, {
    signal: AbortSignal.timeout(5000),
    redirect: 'error',
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ url: webhookUrl })
  });

  if (!res.ok) {
    const error = new Error('avito_webhook_registration_failed'); error.status = res.status; throw error;
  }

  return await safeJson(res);
}

/**
 * Отписка / удаление Webhook в Avito
 */
async function deleteAvitoWebhook(token, webhookUrl) {
  const res = await fetch(`${getBaseUrl()}/messenger/v3/webhook/unsubscribe`, {
    signal: AbortSignal.timeout(5000),
    redirect: 'error',
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ url: webhookUrl })
  });

  if (!res.ok) {
    const error = new Error('avito_webhook_unsubscribe_failed'); error.status = res.status; throw error;
  }

  return await safeJson(res);
}

module.exports = {
  getAccessToken,
  sendAvitoMessage,
  checkAvitoConnection,
  registerAvitoWebhook,
  deleteAvitoWebhook,
  getBaseUrl
};


// Provider bodies may contain private data; never propagate JSON parser snippets.
async function safeJson(response) {
  try { return await response.json(); } catch (_) { throw new Error('provider_invalid_json'); }
}
