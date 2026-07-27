@echo off
setlocal
cd /d "%~dp0"

echo SBI3U local Moodle file repair
echo ==========================================
echo.
echo This rebuilds local document/PDF/H5P files with unique filenames.
echo It does not redownload videos or iSpring packages.
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0RUN_COURSE_MOODLE_MEDIA_LOCALIZATION.ps1" -Course SBI3U -Kind document,pdf,h5p

echo.
pause
