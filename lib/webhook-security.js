const { timingSafeEqual } = require('node:crypto');
function equal(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string' || !expected) return false;
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
function header(event, name) {
  return Object.entries(event.headers || {}).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
}
function authorize(event, env, platform) {
  const names = {
    max: ['MAX_WEBHOOK_SECRET', 'x-max-bot-api-secret'],
    telegram: ['TG_WEBHOOK_SECRET', 'x-telegram-bot-api-secret-token'],
    avito: ['AVITO_WEBHOOK_SECRET', 'x-avito-webhook-secret'],
  };
  const pair = names[platform];
  if (!pair || !env[pair[0]]) return { statusCode: 503, body: '{"error":"webhook_not_configured"}' };
  // Avito does not sign requests. Use a separate high-entropy capability URL;
  // redact it at the gateway and never reuse the Telegram/MAX secret.
  const actual = header(event, pair[1]) || (platform === 'avito' ? event.queryStringParameters?.avito_secret : undefined);
  if (!equal(actual, env[pair[0]])) return { statusCode: 403, body: '{"error":"forbidden"}' };
  return null;
}
function parse(event) {
  let body = event.body;
  if (event.isBase64Encoded) body = Buffer.from(body, 'base64').toString('utf8');
  if (Buffer.byteLength(typeof body === 'string' ? body : JSON.stringify(body ?? null)) > 65536) throw new Error('body_too_large');
  if (typeof body === 'string') body = JSON.parse(body);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid_body');
  return body;
}
module.exports = { equal, header, authorize, parse };
