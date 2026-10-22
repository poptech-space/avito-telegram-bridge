# Telegram Serverless: Прием вебхуков Авито без сторонних серверов

Этот пример демонстрирует запуск обработчика вебхуков Авито на **нативной серверлесс-инфраструктуре Telegram** (на базе V8-изолятов).

Подробнее о технологии: [core.telegram.org/bots/serverless](https://core.telegram.org/bots/serverless).

---

## Преимущества

1. **0 серверов и сторонних облаков**: бот и вебхук исполняются непосредственно на инфраструктуре Telegram.
2. **Встроенная база данных SQLite**: импортируется напрямую через `import { table } from 'sdk/db'`.
3. **Бесплатный хостинг**: базовые лимиты Telegram покрывают стандартные задачи переписки продавцов.

---

## Структура проекта

```text
├── endpoints/
│   └── avito.js         # HTTP-эндпоинт для приема вебхука от Авито
├── bot.js               # Основной обработчик команд Telegram (/start, reply)
└── package.json
```

---

## Быстрый старт

1. Установите CLI для работы с Telegram Cloud:
```bash
npm install -g @tgcloud/cli
```

2. Авторизуйтесь и привяжите проект к вашему боту:
```bash
tgcloud login
tgcloud link
```

3. Задайте переменные окружения:
```bash
tgcloud secret set AVITO_USER_ID=123456789
tgcloud secret set TELEGRAM_CHAT_ID=987654321
```

4. Разверните проект в Telegram Cloud:
```bash
tgcloud deploy
```

После деплоя ваш HTTP-эндпоинт будет доступен по адресу:
`https://<bot-subdomain>.tgcloud.io/endpoints/avito`

Укажите этот URL в личном кабинете Авито API в разделе «Вебхуки Messenger».
