@echo off
REM install.bat - Install all required dependencies for Pharos Auto Bot

REM Install Node.js dependencies
if exist package.json (
  echo Installing root dependencies...
  npm install
)

if exist Pharos-Auto-Bot\package.json (
  echo Installing Pharos-Auto-Bot dependencies...
  cd Pharos-Auto-Bot
  npm install
  cd ..
)

echo All dependencies installed.
pause
