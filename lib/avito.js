/**
 * Модуль взаимодействия с официальным Avito Messenger API
 * Документация: https://api.avito.ru/
 */

let cachedToken = null;
let tokenExpiresAt = 0;

function getBaseUrl() {
  return process.env.AVITO_API_BASE_URL || 'https://api.avito.ru';
}

/**
 * Получение токена доступа OAuth 2.0 (Client Credentials)
 */
async function getAccessToken(clientId, clientSecret) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && tokenExpiresAt > now + 60) {
    return cachedToken;
  }

  const params = new URLSearchParams();
  params.append('grant_type', 'client_credentials');
  params.append('client_id', clientId);
  params.append('client_secret', clientSecret);

  const res = await fetch(`${getBaseUrl()}/token/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Avito auth failed [${res.status}]: ${errorText}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiresAt = now + (data.expires_in || 86400);
  return cachedToken;
}

/**
 * Отправка сообщения покупателю в чат Авито
 */
async function sendAvitoMessage(token, userId, chatId, text) {
  const url = `${getBaseUrl()}/messenger/v1/accounts/${userId}/chats/${chatId}/messages`;
  
  const res = await fetch(url, {
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
    const errorText = await res.text();
    throw new Error(`Avito send message failed [${res.status}]: ${errorText}`);
  }

  return await res.json();
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
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ url: webhookUrl })
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Avito webhook registration failed [${res.status}]: ${errorText}`);
  }

  return await res.json();
}

/**
 * Отписка / удаление Webhook в Avito
 */
async function deleteAvitoWebhook(token, webhookUrl) {
  const res = await fetch(`${getBaseUrl()}/messenger/v3/webhook/unsubscribe`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ url: webhookUrl })
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Avito webhook unsubscribe failed [${res.status}]: ${errorText}`);
  }

  return await res.json();
}

module.exports = {
  getAccessToken,
  sendAvitoMessage,
  checkAvitoConnection,
  registerAvitoWebhook,
  deleteAvitoWebhook,
  getBaseUrl
};

