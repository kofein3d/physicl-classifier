@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Устанавливаю зависимости, это займёт минуту...
  call npm install
)
echo Запускаю dev-сервер: http://localhost:5173/
call npm run dev
pause
