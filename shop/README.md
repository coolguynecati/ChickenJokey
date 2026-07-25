# Emika's Hot Chicken — меню, заказ, CRM

Папка `shop/` в репозитории. Картинки — в `../images/`.

## Локально

```bash
cd shop
npm install
npm start
```

- Сайт: http://localhost:3000  
- CRM: http://localhost:3000/crm.html (пароль в `.env` → `CRM_PASSWORD`, по умолчанию `emika2025`)
- Облако: http://localhost:3000/cloud.html (файлы в `../cloud/`, описание в `cloud.txt` в каждой папке)

## Онлайн (Render.com)

1. Залейте проект на GitHub.
2. [render.com](https://render.com) → **New** → **Blueprint** → подключите репозиторий (файл `render.yaml` подхватится сам).
3. После деплоя откройте URL сервиса и `/crm.html`.
4. Пароль CRM — в переменных окружения Render (`CRM_PASSWORD`).

Заказы хранятся в `data/orders.json` на диске инстанса (на бесплатном плане при перезапуске данные могут сброситься — для продакшена позже подключите БД).

### CRM Дымный Двор (отдельный кабинет)

- URL: `/crm-dymny.html` (или `crm.html?cabinet=dymny-dvor`)
- Пароль: файл `crm-password-dymny-dvor.txt` или `CRM_PASSWORD_DYMNY_DVOR` на Render
- Заказы Emika в этом кабинете **не видны**; пароли Emika здесь не работают

### Уведомления на почту о заказах

После оформления заказа сервер отправляет письмо:

- **Eat Arena** → `eatarena@emikashotchicken.ru` и `info@emikashotchicken.ru`
- **Набережные Челны** → `razvilka@emikashotchicken.ru` и `info@emikashotchicken.ru`
- **Дымный Двор** → `narek@dimniy-dvor.ru` и `info@dimniy-dvor.ru` (или `DYMNY_ORDER_EMAIL`)

Нужны переменные SMTP в `.env` или на Render (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `PUBLIC_SITE_URL`). Проверка: `GET /api/health` → `"orderNotify": true`.

### Google Таблица — неизменяемый журнал (Дымный Двор)

Каждое событие (новый заказ, смена статуса, архив, удаление) **дописывается** в Google Sheets. Менеджеры CRM таблицу не редактируют.

Пошагово: [`docs/GOOGLE_SHEETS.md`](docs/GOOGLE_SHEETS.md).  
Проверка: `/api/health` → `"sheetsAudit": true`.

### Еженедельный Excel на почту

Каждый **понедельник в 09:00 (МСК)** на `narek@dimniy-dvor.ru` уходит письмо с Excel за последние 7 дней:

- лист **Заказы** — состав, времена статусов, кто отправил в архив / удалил  
- лист **События** — хронология  

Нужен настроенный SMTP. Переменные: `WEEKLY_EXPORT_EMAIL`, `CRON_SECRET` (для ручного запуска).  
Проверка: `/api/health` → `"weeklyExport": true`.  
Ручной запуск: `POST /api/cron/weekly-export` с заголовком `x-cron-secret: <CRON_SECRET>`.

Пока Google Таблица не подключена — этого отчёта достаточно для контроля.

### Автопечать заказов на кухне (А4)

В CRM Дымного двора (`/crm-dymny.html`):

1. ПК у принтера, вкладка CRM открыта, USB-принтер — **по умолчанию**.
2. Кнопки в шапке: **Звук → Вкл/Выкл** и **Печать → Вкл/Выкл** (печать для Дымного двора по умолчанию включена).
3. Новый заказ → компактный бланк (белый / чёрный текст); большой заказ — на сколько страниц нужно.
4. Кнопка **«Печать»** в карточке — повтор вручную.

Без диалога каждый раз: ярлык Chrome с `--kiosk-printing`.

### Письмо гостю «уже готовим»

Когда в CRM заказ переводят в **Готовим**, на **email из чекаута** (не Telegram) уходит письмо:

- Тема: «Имя, уже готовим для вас!»
- Тёмный шаблон с логотипом, составом заказа и адресом точки со ссылкой на Яндекс.Карты
- Для «как можно скорее» — время забора ≈ через 20 минут от момента отправки

Повторно не отправляется (поле `cookingEmailSentAt` в заказе).

### Push-уведомления в CRM (Android / PWA)

При новом заказе менеджерам приходит push на телефон (если подписались после входа в CRM).

1. `npm run generate-vapid` — сгенерировать ключи
2. Добавить `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` в Render
3. Проверка: `/api/health` → `"pushNotify": true`

**Android-приложение** (WebView): см. [`../crm-app/README.md`](../crm-app/README.md)

## Быстрый туннель с вашего ПК

Пока сервер запущен (`npm start`):

```bash
npx cloudflared tunnel --url http://localhost:3000
```

В консоли появится публичная ссылка `https://….trycloudflare.com`.
