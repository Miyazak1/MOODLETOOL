@echo off
setlocal
cd /d "%~dp0"

set ADMIN_UPLOADS_ENABLED=1
set ADMIN_TOKEN=local-admin-token
set ADMIN_USERNAME=admin
set ADMIN_PASSWORD=local-admin-password
set ADMIN_SESSION_SECRET=local-dev-session-secret-change-me
set ADMIN_MAX_DOCUMENT_MB=50
set ADMIN_MAX_ISPRING_MB=2048
set PORTAL_AUTH_ENABLED=1
set PORTAL_SESSION_SECRET=local-dev-portal-session-secret-change-me
set PORTAL_USERS_JSON=[{"username":"admin","password":"local-admin-password","role":"admin","courses":["*"]},{"username":"teacher","password":"teacher-password","role":"teacher","courses":["ENG3U","ESLEO"]}]

echo.
echo OSSD Course Portal local server
echo ===============================
echo Preferred website: http://127.0.0.1:8891/
echo Actual website:    printed below after startup
echo Admin:   Click the admin link in the website header
echo Portal: admin / local-admin-password  or  teacher / teacher-password
echo Admin:  admin / local-admin-password
echo.
echo Keep this window open while viewing the website.
echo If 8891 is busy, this launcher will use the next available port.
echo.

if not exist "node_modules" (
  echo Dependencies are missing. Running npm install first...
  call npm.cmd install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

call npm.cmd run build
if errorlevel 1 (
  pause
  exit /b 1
)

node server.mjs --root dist --port 8891 --port-end 8895 --open
pause
