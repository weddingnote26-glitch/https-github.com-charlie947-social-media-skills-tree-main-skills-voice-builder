@echo off
chcp 65001 >nul
title 오락푸드 AI릴스 스튜디오 - 폴더 열기
cd /d "%~dp0"
setlocal enabledelayedexpansion

set "APPNAME=오락푸드 AI릴스 자동제작 스튜디오"
set "SRC=%CD%"
set "SETUP=%CD%\dist-installer"
set "DOCS=%USERPROFILE%\Documents\오락푸드 AI릴스"

:MENU
cls
echo.
echo  ================================================
echo    폴더 열기
echo  ================================================
echo.
echo   [1] 설치된 프로그램 폴더   - 실행파일 exe 가 있는 곳
echo   [2] 설치 파일 폴더         - 설치용 Setup.exe 를 만든 곳
echo   [3] 완성 영상 폴더         - 내 문서 아래
echo   [4] 프로그램 소스 폴더     - 지금 이 파일이 있는 곳
echo.
echo   [0] 닫기
echo.
set "PICK="
set /p PICK=  번호를 누르고 Enter: 

if "%PICK%"=="1" goto FIND_INSTALLED
if "%PICK%"=="2" goto OPEN_SETUP
if "%PICK%"=="3" goto OPEN_DOCS
if "%PICK%"=="4" goto OPEN_SRC
if "%PICK%"=="0" goto BYE
goto MENU


rem ── 설치된 자리를 찾는다 ─────────────────────────────
rem 설치할 때 폴더를 바꿀 수 있으므로 기본 자리만 믿지 않는다.
rem 1) 기본 자리  2) 바탕화면 바로가기가 가리키는 곳  3) 시작 메뉴 바로가기
:FIND_INSTALLED
set "FOUND="

set "TRY=%LOCALAPPDATA%\Programs\%APPNAME%"
if exist "!TRY!" set "FOUND=!TRY!"
if defined FOUND goto OPEN_INSTALLED

call :FROM_LNK "%USERPROFILE%\Desktop\%APPNAME%.lnk"
if defined FOUND goto OPEN_INSTALLED

call :FROM_LNK "%APPDATA%\Microsoft\Windows\Start Menu\Programs\%APPNAME%.lnk"
if defined FOUND goto OPEN_INSTALLED

goto NOT_INSTALLED

rem 바로가기(.lnk)가 가리키는 exe 의 폴더를 읽어 온다
:FROM_LNK
if not exist "%~1" goto :eof
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "try{$s=New-Object -ComObject WScript.Shell;$t=$s.CreateShortcut('%~1').TargetPath;if($t){Split-Path -Parent $t}}catch{}" 2^>nul`) do set "FOUND=%%P"
if not defined FOUND goto :eof
if not exist "!FOUND!" set "FOUND="
goto :eof

:OPEN_INSTALLED
echo.
echo  [i] 여는 중: !FOUND!
start "" "!FOUND!"
echo.
pause
goto MENU

:NOT_INSTALLED
echo.
echo  [X] 설치된 프로그램을 찾지 못했습니다.
echo.
echo      찾아본 곳
echo        1. %LOCALAPPDATA%\Programs\%APPNAME%
echo        2. 바탕화면 바로가기
echo        3. 시작 메뉴 바로가기
echo.
echo      아직 설치하지 않으셨다면 [설치파일만들기.bat] 으로 Setup.exe 를 만들고
echo      그 파일을 실행해 설치하시면 이 폴더가 생깁니다.
echo.
echo      설치 없이 쓰시는 중이라면 [4] 프로그램 소스 폴더를 보세요.
echo      그 폴더의 start.bat 이 실행 파일 역할을 합니다.
echo.
pause
goto MENU


:OPEN_SETUP
if not exist "%SETUP%" goto NO_SETUP
echo.
echo  [i] 여는 중: %SETUP%
start "" "%SETUP%"
echo.
pause
goto MENU

:NO_SETUP
echo.
echo  [X] 설치 파일을 아직 만들지 않았습니다.
echo      찾아본 곳: %SETUP%
echo.
echo      [설치파일만들기.bat] 을 두 번 누르면 만들어집니다. 10~20분 걸립니다.
echo.
pause
goto MENU


:OPEN_DOCS
if not exist "%DOCS%" goto NO_DOCS
echo.
echo  [i] 여는 중: %DOCS%
start "" "%DOCS%"
echo.
pause
goto MENU

:NO_DOCS
echo.
echo  [!] 완성 영상 폴더가 아직 없습니다. 릴스를 한 편 만들면 생깁니다.
echo      생길 자리: %DOCS%
echo.
pause
goto MENU


:OPEN_SRC
echo.
echo  [i] 여는 중: %SRC%
start "" "%SRC%"
echo.
pause
goto MENU

:BYE
endlocal
exit /b 0
