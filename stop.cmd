@echo off
setlocal
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8787" ^| findstr LISTENING') do (
  echo [agy] kill PID %%p
  taskkill /PID %%p /F >nul 2>nul
)
echo [agy] da dung proxy (neu co).
