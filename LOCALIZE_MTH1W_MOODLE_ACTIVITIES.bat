@echo off
setlocal
cd /d "%~dp0"

echo MTH1W Moodle activity localizer
echo ==========================================
echo.
echo This converts Moodle activity links in MTH1W into local files/pages.
echo Resource files are downloaded; pages/folders/assignments become local HTML.
echo External URL activities become local entry pages with the real external link.
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0RUN_COURSE_MOODLE_ACTIVITY_LOCALIZATION.ps1" -Course MTH1W

echo.
pause
