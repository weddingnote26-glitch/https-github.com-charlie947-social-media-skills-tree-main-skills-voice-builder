@echo off
rem ============================================================
rem   Update market data table in sources.md
rem
rem   For Windows Task Scheduler. Korean messages live in the
rem   Python script so this file stays plain ASCII.
rem ============================================================

setlocal
set "HERE=%~dp0"
set "PY=%HERE%.venv\Scripts\python.exe"

if not exist "%PY%" (
    echo [ERROR] Python environment not found: "%PY%"
    echo         Run setup.ps1 once first.
    exit /b 1
)

"%PY%" "%HERE%scripts\update_sources.py" %*
exit /b %ERRORLEVEL%
