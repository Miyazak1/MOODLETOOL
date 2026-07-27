@echo off
setlocal
cd /d "%~dp0"

echo SBI3U Moodle media downloader
echo =============================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0RUN_COURSE_MOODLE_MEDIA_LOCALIZATION.ps1" -Course SBI3U

echo.
pause
