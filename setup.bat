@echo off
setlocal EnableExtensions EnableDelayedExpansion
title dsh-agy setup
set "REPO=trinhnguyen959/dsh-agy"
set "BRANCH=plugin"
set "DEST=%LOCALAPPDATA%\dsh-agy"
if defined AGY_DIR set "DEST=%AGY_DIR%"
set "DSH=%USERPROFILE%\.dsh"
if defined DSH_HOME set "DSH=%DSH_HOME%"

echo =======================================================
echo     dsh-agy - Cai Antigravity cho DeepSeek Harness
echo =======================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [X] Chua co Node.js. Hay tai va cai Node.js ban 18 tro len tai:
  echo     https://nodejs.org
  pause
  exit /b 1
)
node -e "process.exit((+process.versions.node.split('.')[0])>=18?0:1)"
if errorlevel 1 (
  echo [X] Ban Node.js tren may qua cu. Can Node.js 18 tro len:
  node -v
  pause
  exit /b 1
)

tasklist /FI "IMAGENAME eq DeepSeek Harness.exe" 2>nul | find /I "DeepSeek Harness.exe" >nul
if not errorlevel 1 (
  echo [WARN] DeepSeek Harness dang mo.
  echo        Khuyen nghi DONG DSH truoc khi cai dat de cau hinh duoc nạp sach.
  echo        Neu da dong DSH, bam phim bat ky de tiep tuc...
  pause >nul
)

if not exist "%DEST%\proxy.mjs" goto download
if defined AGY_FORCE goto download
echo [1/4] Code da co san tai "%DEST%".
goto afterdownload

:download
echo [1/4] Dang tai bo cai dsh-agy tu GitHub...
set "ZIP=%TEMP%\dsh-agy-%RANDOM%.zip"
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -Uri 'https://codeload.github.com/%REPO%/zip/refs/heads/%BRANCH%' -OutFile '!ZIP!' -UseBasicParsing | Out-Null } catch { exit 1 }"
if errorlevel 1 (
  echo [X] Khong the tai tu GitHub. Vui long kiem tra ket noi mang.
  pause
  exit /b 1
)
set "TMPX=%TEMP%\dsh-agy-x-%RANDOM%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Expand-Archive -LiteralPath '!ZIP!' -DestinationPath '!TMPX!' -Force } catch { exit 1 }"
if errorlevel 1 (
  echo [X] Giai nen that bai.
  pause
  exit /b 1
)
for /d %%D in ("!TMPX!\*") do robocopy "%%D" "%DEST%" /E /NFL /NDL /NJH /NJS /NP >nul
rd /s /q "!TMPX!" 2>nul
del "!ZIP!" 2>nul
if not exist "%DEST%\proxy.mjs" (
  echo [X] Khong tim thay file proxy.mjs sau khi giai nen.
  pause
  exit /b 1
)

:afterdownload
cd /d "%DEST%"

echo [2/4] Kiem tra dang nhap Google Antigravity...
if not exist "%USERPROFILE%\.agy-dsh\credential.json" (
  echo       Mo trinh duyet de dang nhap Google...
  node login.mjs
  if errorlevel 1 (
    echo [X] Dang nhap that bai hoac bi huy.
    pause
    exit /b 1
  )
) else (
  echo       Da co credential dang nhap, bo qua buoc nay.
)

echo [3/4] Cai dat Provider vao cac profile DSH (Desktop va Web)...
if not exist "%DSH%\profiles" (
  echo [WARN] Chua thay thu muc "%DSH%\profiles".
  echo        Hay mo DeepSeek Harness len mot lan, sau do dong lai roi chay file nay.
  pause
  exit /b 1
)

node install-dsh.mjs
if errorlevel 1 (
  echo [X] Cau hinh DSH that bai.
  pause
  exit /b 1
)

echo [4/4] Khoi dong Proxy Antigravity...
start "dsh-agy proxy" /min cmd /c "cd /d "%DEST%" && node start.mjs"

echo.
echo =======================================================
echo  THANH CONG!
echo  1. Proxy da duoc khoi dong ngam tai port 8787.
echo  2. Ca Desktop va Web profile cua DSH da duoc cai route.
echo.
echo  Bay gio ban chi can MO DEEPSEEK HARNESS len:
echo  -> Bam vao Model Picker o goc duoi
echo  - Chon nhom: Antigravity [local]
echo  - Chon model: Gemini 3 Flash hoac Claude Sonnet 4.6 la dung duoc luon!
echo =======================================================
echo.
pause
exit /b 0
