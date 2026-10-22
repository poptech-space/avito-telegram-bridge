/**
 * Вспомогательный загрузчик .env без внешних зависимостей
 */
const fs = require('fs');
const path = require('path');

function loadEnv(envPath) {
  const targetPath = envPath || path.resolve(__dirname, '..', '.env');
  if (!fs.existsSync(targetPath)) {
    return {};
  }

  const content = fs.readFileSync(targetPath, 'utf8');
  const env = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = val;
    }
    env[key] = val;
  }

  return env;
}

module.exports = { loadEnv };
