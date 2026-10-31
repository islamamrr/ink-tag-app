@echo off
rem Starts the Ink Tag Dev Tool. First time: run setup.bat
cd /d "%~dp0"
if exist .venv\Scripts\pythonw.exe (
  start "" .venv\Scripts\pythonw.exe -m inktag_devtool %*
) else (
  echo Run setup.bat first.
  pause
)
