@echo off
rem ============================================================
rem   Naver Blog Automation - double-click launcher
rem
rem   All Korean messages live in the .ps1 file on purpose,
rem   so this file stays plain ASCII and never breaks on any
rem   Windows codepage.
rem ============================================================

setlocal
set "HERE=%~dp0"
set "PS1=%HERE%start-naver-blog-automation.ps1"

if not exist "%PS1%" (
    echo.
    echo  [ERROR] start-naver-blog-automation.ps1 was not found.
    echo          Expected at: "%PS1%"
    echo.
    echo  Keep this .bat file inside the naver-blog-automation folder.
    echo.
    pause
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %*
set "RC=%ERRORLEVEL%"

if "%RC%"=="9009" (
    echo.
    echo  [ERROR] Windows PowerShell was not found on this PC.
    echo          Please contact your IT administrator.
    echo.
    pause
)

endlocal & exit /b %RC%
