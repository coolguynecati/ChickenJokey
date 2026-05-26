# Запуск сайта + публичный туннель (пока окно открыто)
Write-Host "Запуск сервера на http://localhost:3000 ..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot'; npm start"

Start-Sleep -Seconds 3

Write-Host ""
Write-Host "Создаём публичную ссылку (Cloudflare)..."
Write-Host "Скопируйте URL из строки trycloudflare.com ниже."
Write-Host "CRM: <ваш-url>/crm.html  |  Пароль: emika2025 (или из .env)"
Write-Host ""

npx --yes cloudflared tunnel --url http://127.0.0.1:3000
