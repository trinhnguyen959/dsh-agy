@echo off
setlocal
cd /d "%~dp0"
title dsh-agy Account Manager

where node >nul 2>nul
if errorlevel 1 (
  echo [X] Chua co Node.js tren may. Hay cai Node.js 18+ tai https://nodejs.org
  pause
  exit /b 1
)

if not "%~1"=="" (
  node login.mjs %*
  goto end
)

echo ========================================================
echo       dsh-agy - Quan ly tai khoan Antigravity
echo ========================================================
echo.
echo  [1] Dang nhap them tai khoan moi (mo trinh duyet)
echo  [2] Xem danh sach tai khoan hien co trong Pool
echo  [3] Xem chi tiet Quota cac tai khoan
echo  [0] Thoat
echo.
set /p "CHOICE=Nhap lua chon [1, 2, 3 hoac Enter de dang nhap]: "
set "CHOICE=%CHOICE: =%"
if "%CHOICE%"=="" set "CHOICE=1"

if "%CHOICE%"=="1" (
  echo.
  node login.mjs
) else if "%CHOICE%"=="2" (
  echo.
  node login.mjs --list
) else if "%CHOICE%"=="3" (
  echo.
  node status.mjs
) else if "%CHOICE%"=="0" (
  exit /b 0
) else (
  echo Lua chon khong hop le.
)

:end
echo.
pause
