@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [agy] Can Node.js 18 tro len. Tai: https://nodejs.org
  pause
  exit /b 1
)
set "AGY_RUN="
where pnpm >nul 2>nul
if not errorlevel 1 (
  call pnpm -v >nul 2>nul && set "AGY_RUN=pnpm start"
)
if defined AGY_RUN (
  call %AGY_RUN% %*
) else (
  node start.mjs %*
)
pause
