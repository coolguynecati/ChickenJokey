# Emika's Hot Chicken — репозиторий сайта

## Структура

```
├── images/          # общие картинки и видео
├── franchise/       # страница франшизы
├── cloud/           # файловое «облако» (папки + cloud.txt)
├── shop/            # меню, заказ, CRM, сервер
│   ├── index.html
│   ├── cloud.html
│   ├── checkout.html
│   ├── crm.html
│   ├── server/
│   └── package.json
└── index.html       # редирект на shop/
```

## Запуск магазина и CRM

```bash
cd shop
npm install
npm start
```

- Сайт: http://localhost:3000  
- CRM: http://localhost:3000/crm.html (пароль: `CRM_PASSWORD` в `shop/.env`, по умолчанию `emika2025`)
- Облако: http://localhost:3000/cloud.html

## Облако (файлы без правки кода)

1. Создайте папку в `cloud/`, например `cloud/маркетинг/`.
2. Положите туда `cloud.txt`:

```
Name: Маркетинг
Description: Баннеры и креативы для соцсетей
Type: gallery
```

3. Добавьте файлы (jpg, pdf, mp4…) — они появятся на `/cloud.html` после перезагрузки страницы.

Поле `Type` необязательно: `gallery`, `documents`, `files` или `auto` (по типам файлов).

## Деплой (Render)

В настройках сервиса укажите **Root Directory**: `shop`  
Либо используйте `render.yaml` в корне репозитория.

## Git

Не коммитьте `shop/node_modules/`, `shop/data/`, `.env` — они уже в `.gitignore`.
