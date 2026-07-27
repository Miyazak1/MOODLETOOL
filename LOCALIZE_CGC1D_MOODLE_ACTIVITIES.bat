@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0RUN_COURSE_MOODLE_ACTIVITY_LOCALIZATION.ps1" -Course CGC1D
pause
