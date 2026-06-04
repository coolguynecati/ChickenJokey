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

### Уведомления на почту о заказах

После оформления заказа сервер отправляет письмо:

- **Eat Arena** → `eatarena@emikashotchicken.ru` и `info@emikashotchicken.ru`
- **пос. Развилка** → `razvilka@emikashotchicken.ru` и `info@emikashotchicken.ru`

Нужны переменные SMTP в `.env` или на Render (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `PUBLIC_SITE_URL`). Проверка: `GET /api/health` → `"orderNotify": true`.

### Письмо гостю «уже готовим»

Когда в CRM заказ переводят в **Готовим**, на **email из чекаута** (не Telegram) уходит письмо:

- Тема: «Имя, уже готовим для вас!»
- Тёмный шаблон с логотипом, составом заказа и адресом точки со ссылкой на Яндекс.Карты
- Для «как можно скорее» — время забора ≈ через 20 минут от момента отправки

Повторно не отправляется (поле `cookingEmailSentAt` в заказе).

## Быстрый туннель с вашего ПК

Пока сервер запущен (`npm start`):

```bash
npx cloudflared tunnel --url http://localhost:3000
```

В консоли появится публичная ссылка `https://….trycloudflare.com`.
