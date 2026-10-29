# Avito bridge: локальная проверка и выпуск

Поддерживается только YCF Node.js 22 + YDB. Локальные проверки не означают
развёртывание. Разработка не разрешает commit, push, provision, миграции,
регистрацию webhook, отправки и расходы автоматически.

## Рабочее место

Node.js 22 (версия в `.nvmrc`), Python 3, ansible-core 2.20.5 из `ops/requirements.txt`.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run simulate
npm run emulator
./ops/run
```

Тесты и эмулятор offline. `npm run simulate` не принимает URL и никогда не вызывает
облачную функцию. В CI используются те же npm-команды, без клиентских секретов.
Ansible build дополнительно проверяет чистый SHA в изолированном Git-архиве.

## Подготовка клиента и секретов

Один клиент — свои репозиторий, папка, YDB, runtime SA, ingress и приватный worker.
Создание ресурсов, IAM, таймера и расходы — отдельные действия владельца.
`provision` намеренно отказывает. Не использовать чужую БД или default-профиль CLI.

Скопировать `ops/config.example.json` вне Git, заменить placeholders проверенными ID.
`remote` должен совпадать с origin, путь YDB — принадлежать папке клиента. Для worker
сделать отдельную копию с его functionId и `entrypoint: "worker.handler"`.
Зафиксировать подтверждённый `TELEGRAM_BOT_ID` в окружении и `botIdentities`.
У обоих runtime одни клиентские БД и `BOT_DATA_SECRET`.

`secretEnvironment` содержит имена локальных `DEPLOY_*`; значения читаются из
окружения доверенного процесса только при preflight/deploy/verify и передаются
в обычные переменные Cloud Functions. Lockbox не обязателен. Секреты webhook —
случайные URL-safe строки 32–256 символов; `BOT_DATA_SECRET` — минимум 32 символа.
Значения не передавать аргументами команд, в Ansible `-e`, Git, manifest и логи.
Не запускать debug/shell tracing. Доступ к облаку и IAM обеспечивает заказчик,
защиту кода, сборки и выпуска — студия.

`BOT_DATA_SECRET` задаёт ключи существующих записей. Его смена требует отдельного
переноса данных. При утечке отозвать токен у провайдера, обновить оба runtime и
webhook при необходимости; старые версии могут содержать прежние значения.

## Сборка и выпуск

До выпуска: diff, секреты, offline-тесты, `git diff --check`; отдельно согласовать
commit/push и убедиться, что выбранный чистый SHA есть на remote. Контроллер сам
Git не публикует. Untracked-файлы блокируют сборку.

```sh
./ops/run -e bot_operation=build -e bot_config=/private/tmp/avito-staging.json
./ops/run -e bot_operation=handoff -e bot_config=/private/tmp/avito-staging.json
```

Build устанавливает зависимости по lockfile без install scripts и запускает тесты
без bot/cloud/DB credentials. Manifest закрепляет source/config/archive hashes.
Артефакты лежат в `artifacts/<client>/<environment>/<provider>-<functionId>/<SHA>/`.
Ingress и worker собираются отдельно. Подмена архива/конфига блокирует выпуск.
`.release-lock` исключает одновременные операции. После аварии сначала сверить
receipt и состояние облака; не удалять lock для слепого повтора POST.

После проверки клиентского доступа и отдельного согласования миграции/выпуска:

```sh
./ops/run -e bot_operation=preflight -e bot_config=/private/tmp/avito-staging.json
./ops/run -e bot_operation=migrate -e bot_config=/private/tmp/avito-staging.json
./ops/run -e bot_operation=deploy -e bot_config=/private/tmp/avito-staging.json
./ops/run -e bot_operation=verify -e bot_config=/private/tmp/avito-staging.json
```

`YC_IAM_TOKEN` передаётся через окружение. Preflight проверяет bot identity и
принадлежность ресурсов клиенту. Миграция `001-records` создаёт `bot_records` и
`bot_queue` с TTL. `IF NOT EXISTS` не исправляет старую неверную схему — сверить её.
Runtime SA получает права только на клиентскую БД, DDL — отдельно на время миграции.
Worker не должен иметь invoke для allUsers/allAuthenticatedUsers; таймер вызывает
его от SA. Срок хранения и snapshot/restore согласовать до обработки реальных данных.

## Безопасное включение доставки

1. Выпустить ingress и worker с `AUTO_REPLY_ENABLED=false`, `DELIVERY_ENABLED=false`.
2. Проверить версии, ACL worker, схему/TTL, bot ID, ID продавца и оператора.
3. При существующей БД прочитать статусы через recovery, проверить возраст и адресатов
   pending в защищённой консоли. Команда recovery не выводит тексты/получателей;
   полный аудит backlog требует отдельного read-only доступа к БД.
4. Зарегистрировать webhook отдельным действием на согласованного staging-бота.
   `.env` используется только локальными регистрационными скриптами; runtime его не читает.
5. Проверить сохранение одного события при отключённой доставке. В worker-конфиге
   явно установить `DELIVERY_ENABLED=true`, заново собрать/выпустить/проверить его.
   Это разрешает отправку всех накопленных pending, не только нового теста.
6. Выполнить staging-приёмку ниже. Автоответ включать отдельно: он отправляется на
   каждое новое входящее сообщение, а не один раз на покупателя.

Для паузы выключить таймер и запретить новые запуски, дождаться завершения текущего
вызова, затем выпустить worker с `DELIVERY_ENABLED=false`. Переключатель сам по себе
не отменяет POST работающей версии. Не менять статусы sent/unknown/sending на pending.

Регистрационные команды требуют явного HTTPS URL без секретов в аргументе:

```sh
npm run register:tg -- https://functions.yandexcloud.net/REPLACE_WITH_INGRESS_ID
npm run register:avito -- https://functions.yandexcloud.net/REPLACE_WITH_INGRESS_ID
npm run ping -- https://functions.yandexcloud.net/REPLACE_WITH_INGRESS_ID
```

Avito-скрипт добавляет capability из `AVITO_WEBHOOK_SECRET` в памяти. Query/access
logs должны быть скрыты до регистрации. Telegram использует `secret_token`.
После неизвестного результата регистрации сверить провайдера перед повтором.
Не запускать polling параллельно webhook. GET health подтверждает только доступность
обработчика, не состояние БД, worker или факт доставки.

## Приёмка и наблюдение

На отдельном staging-боте: валидный webhook → durable запись → один фактический
получатель → Reply на карточку → правильный покупатель. Повторить update после
холодного старта: второй отправки быть не должно в пределах dedup. Проверить неправильный
секрет, другого actor, группу, Reply на чужого бота, маркер в тексте покупателя,
ошибку БД до ACK, нетекстовое и длинное сообщение. Проверить недоступность получателя,
неопределённый результат POST и сохранность задания после ошибки записи результата.
Не инъецировать синтетические события в production.

Мониторить 5xx, конфликты YDB, возраст pending, число rejected/unknown, lease и расходы.
Период таймера добавляется к задержке и расходует вызовы даже без новых сообщений.
Бюджет уведомлений не является жёстким лимитом расходов. Нагрузочные SLO и квоты
API требуют измерений. Лимиты пилота и остановка после 100 submissions на запись
описаны в [архитектуре](ARCHITECTURE.md); длительная эксплуатация требует другой
разбивки истории, а не автоматического удаления заданий.

## Восстановление, backup и откат

`node lib/recover-delivery.js` читает страницу ID/статусов; `--after <cursor>`
продолжает. Нужны явные YDB_ENDPOINT/YDB_DATABASE и IAM_TOKEN доверенного оператора.
`--retry-rejected --record <64hex> --job <id>` возвращает только конкретный rejected
в pending; отправляет worker при включённой доставке. Перед повтором сверить
причину отказа. Unknown не повторять: сначала проверить фактический чат/провайдера
и согласовать ручное восстановление. Автоматической очистки backlog нет.

Снять штатный зашифрованный snapshot/export отдельно от source, зафиксировать схему,
дату, ресурс, SHA-256 и срок хранения. Репетировать restore в изолированной БД с
отключённой отправкой. Экспорт статусов не заменяет backup. TTL удаляет данные
асинхронно и не чистит старые таблицы/резервные копии.

`handoff` упаковывает source, manifest и несекретный config; не включает credentials,
node_modules и дампы БД. Доступы и backup передаются отдельно безопасным способом.
`rollback` — отдельная согласованная операция кода, без отката БД/webhook/секретов/
таймера. После timeout сверить активную версию и receipt до повторного действия.
