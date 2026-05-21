# Emika's Hot Chicken — сайт + CRM заказов

## Локально

```bash
npm install
npm start
```

- Сайт: http://localhost:3000  
- CRM: http://localhost:3000/crm.html (пароль в `.env` → `CRM_PASSWORD`, по умолчанию `emika2025`)

## Онлайн (Render.com)

1. Залейте проект на GitHub.
2. [render.com](https://render.com) → **New** → **Blueprint** → подключите репозиторий (файл `render.yaml` подхватится сам).
3. После деплоя откройте URL сервиса и `/crm.html`.
4. Пароль CRM — в переменных окружения Render (`CRM_PASSWORD`).

Заказы хранятся в `data/orders.json` на диске инстанса (на бесплатном плане при перезапуске данные могут сброситься — для продакшена позже подключите БД).

## Быстрый туннель с вашего ПК

Пока сервер запущен (`npm start`):

```bash
npx cloudflared tunnel --url http://localhost:3000
```

В консоли появится публичная ссылка `https://….trycloudflare.com`.
