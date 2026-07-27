@echo off
setlocal
cd /d "%~dp0"

echo ENG2D Moodle activity localizer
echo ==========================================
echo.
echo This converts Moodle activity links in ENG2D into local files/pages.
echo Resource files are downloaded; pages/folders/assignments/forums become local HTML.
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0RUN_COURSE_MOODLE_ACTIVITY_LOCALIZATION.ps1" -Course ENG2D

echo.
pause
