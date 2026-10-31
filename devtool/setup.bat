@echo off
rem One-time setup: creates a private Python environment and installs the tool's packages.
cd /d "%~dp0"
py -3 -m venv .venv || (echo Python 3.10 or newer is needed: https://www.python.org/downloads/ & pause & exit /b 1)
.venv\Scripts\python.exe -m pip install --upgrade pip
.venv\Scripts\python.exe -m pip install -r requirements.txt
echo.
echo Done. Start the tool with run.bat
pause
