@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-maple.ps1" %*
if errorlevel 1 (
  echo.
  echo Maple could not start. Please read the message above.
  pause
  exit /b 1
)
