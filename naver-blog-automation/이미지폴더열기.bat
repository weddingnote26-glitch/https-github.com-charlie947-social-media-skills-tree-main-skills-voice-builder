@echo off
chcp 65001 >nul
title 네이버 블로그 - 이미지 폴더 열기
cd /d "%~dp0"

rem 오늘 날짜를 YYYY-MM-DD 로 (지역 설정을 타지 않게 PowerShell 로 받는다)
set "TODAY="
for /f %%d in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set "TODAY=%%d"
if not defined TODAY set "TODAY=날짜를 직접 넣으세요"

:MENU
cls
echo.
echo  ================================================
echo    이미지 넣을 폴더 열기
echo  ================================================
echo.
echo    오늘 : %TODAY%
echo.
echo    [1] 코인 - 오늘 글
echo    [2] 경제 - 오늘 글
echo.
echo    [3] 코인 - 날짜 직접 고르기
echo    [4] 경제 - 날짜 직접 고르기
echo.
echo    [5] 이번 주 폴더 통째로 열기
echo.
echo    [0] 닫기
echo.
set "PICK="
set /p PICK=  번호를 누르고 Enter: 

if "%PICK%"=="1" goto C_TODAY
if "%PICK%"=="2" goto S_TODAY
if "%PICK%"=="3" goto C_ASK
if "%PICK%"=="4" goto S_ASK
if "%PICK%"=="5" goto WEEK
if "%PICK%"=="0" goto BYE
goto MENU

:C_TODAY
set "CH=coin"
set "DT=%TODAY%"
goto OPEN

:S_TODAY
set "CH=stock"
set "DT=%TODAY%"
goto OPEN

:C_ASK
set "CH=coin"
goto ASKDATE

:S_ASK
set "CH=stock"
goto ASKDATE

:ASKDATE
echo.
set "DT="
set /p DT=  날짜를 넣으세요 (예: 2026-08-27): 
if not defined DT goto MENU
goto OPEN

:OPEN
set "FOUND="
for /d %%W in ("output\*") do call :TRY "%%W"
if not defined FOUND goto NOTFOUND
echo.
echo   폴더를 엽니다.
echo   %FOUND%
echo.
echo   만든 이미지를 이 창에 끌어다 놓으시면 됩니다.
start "" "%FOUND%"
timeout /t 3 >nul
goto MENU

:TRY
if exist "%~1\%CH%\%DT%\images\" set "FOUND=%CD%\%~1\%CH%\%DT%\images"
goto :eof

:NOTFOUND
echo.
echo   [없음] %CH% / %DT% 폴더를 찾지 못했습니다.
echo          날짜가 맞는지 확인해 주세요.
echo.
pause
goto MENU

:WEEK
set "LAST="
for /d %%W in ("output\*") do set "LAST=%CD%\%%W"
if not defined LAST goto NOWEEK
start "" "%LAST%"
timeout /t 2 >nul
goto MENU

:NOWEEK
echo.
echo   [없음] output 폴더가 비어 있습니다.
echo.
pause
goto MENU

:BYE
exit /b 0
