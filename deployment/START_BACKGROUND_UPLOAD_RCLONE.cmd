@echo off
setlocal

rem Configure these before running.
rem Example Remote values:
rem   r2:school-courseware
rem   s3:school-courseware
rem   gdrive:OSSD-Courseware
set COURSE=ENG3U
set REMOTE=CHANGE_ME_REMOTE
set DESTINATION=

if "%REMOTE%"=="CHANGE_ME_REMOTE" (
  echo Edit %~f0 and set REMOTE before uploading.
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0upload-courseware-rclone.ps1" -Course "%COURSE%" -Remote "%REMOTE%" -Destination "%DESTINATION%" -Background

endlocal
