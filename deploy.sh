#!/usr/bin/env bash
set -e

# ==============================================================================
# Скрипт быстрого деплоя «Авито-Перехватчика» в Yandex Cloud Functions
# Требования: установленный и авторизованный CLI Yandex Cloud (yc init)
# ==============================================================================

FUNCTION_NAME="${1:-avito-bridge}"
RUNTIME="nodejs18"
ENTRYPOINT="index.handler"
MEMORY="128m"
EXECUTION_TIMEOUT="5s"

echo "📦 1. Упаковка исходного кода в zip-архив..."
ZIP_NAME="function-build.zip"
rm -f "$ZIP_NAME"
zip -r "$ZIP_NAME" index.js lib/ package.json -x "*.DS_Store*" -x ".env*"

echo "🔍 2. Проверка существования функции '$FUNCTION_NAME'..."
if ! yc serverless function get --name "$FUNCTION_NAME" >/dev/null 2>&1; then
  echo "🚀 Функция не найдена, создаем новую..."
  yc serverless function create --name "$FUNCTION_NAME"
fi

ENV_ARGS=()
if [ -f .env ]; then
  echo "🔑 Загрузка переменных окружения из .env..."
  while IFS= read -r line || [ -n "$line" ]; do
    line=$(echo "$line" | tr -d '\r')
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ -z "$line" ]] && continue
    
    key="${line%%=*}"
    value="${line#*=}"
    
    key=$(echo "$key" | xargs)
    value=$(echo "$value" | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")
    
    if [ -n "$key" ] && [ -n "$value" ]; then
      ENV_ARGS+=("--environment" "$key=$value")
    fi
  done < .env
  echo "   Загружено переменных: $(( ${#ENV_ARGS[@]} / 2 ))"
else
  echo "⚠️ Файл .env не найден. Переменные окружения функции не будут обновлены."
  echo "   Для конфигурации скопируйте .env.example в .env и заполните параметры."
fi

echo "📤 3. Создание новой версии функции из архива..."
yc serverless function version create \
  --function-name "$FUNCTION_NAME" \
  --runtime "$RUNTIME" \
  --entrypoint "$ENTRYPOINT" \
  --memory "$MEMORY" \
  --execution-timeout "$EXECUTION_TIMEOUT" \
  --source-path "$ZIP_NAME" \
  "${ENV_ARGS[@]}"

echo "🔓 4. Включение публичного доступа к функции для приема вебхуков Авито и Telegram..."
yc serverless function allow-unauthenticated-invoke --name "$FUNCTION_NAME"

FUNCTION_ID=$(yc serverless function get --name "$FUNCTION_NAME" --format json | grep -o '"id": "[^"]*' | cut -d'"' -f4)
WEBHOOK_URL="https://functions.yandexcloud.net/$FUNCTION_ID"

echo "=============================================================================="
echo "✅ ДЕПЛОЙ УСПЕШНО ЗАВЕРШЕН!"
echo "🔗 Ваш публичный Webhook URL:"
echo "$WEBHOOK_URL"
echo ""
echo "👉 Следующие шаги:"
echo "1. Проверка доступности:      node scripts/test-live-ping.js"
echo "2. Регистрация в Telegram:    node scripts/register-telegram-webhook.js"
echo "3. Регистрация в Авито:       node scripts/register-avito-webhook.js"
echo "=============================================================================="

rm -f "$ZIP_NAME"
