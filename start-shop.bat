@echo off
cd /d "%~dp0shop"
echo Installing dependencies...
call npm install
echo.
echo Starting Emika shop + CRM on http://localhost:3000
echo Press Ctrl+C to stop.
echo.
npm start
