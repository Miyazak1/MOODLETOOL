@echo off
setlocal
cd /d "%~dp0"

echo Moodle media downloader
echo =======================
echo This works for any course that already has raw Moodle book files in inbox.
echo Example raw files: inbox\moodle-book-raw-SBI3U-U01.json
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0RUN_COURSE_MOODLE_MEDIA_LOCALIZATION.ps1"

echo.
pause
