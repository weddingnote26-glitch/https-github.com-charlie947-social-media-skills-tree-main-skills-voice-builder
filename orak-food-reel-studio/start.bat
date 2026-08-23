@echo off
chcp 65001 >nul
title 오락푸드 AI 릴스 스튜디오
cd /d "%~dp0"

echo.
echo  ================================================
echo    오락푸드 AI 릴스 자동제작 스튜디오
echo    만두탐정 오락이와 함께 시작합니다
echo  ================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo  [X] Node.js가 설치되어 있지 않습니다.
  echo      https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행하세요.
  pause
  exit /b 1
)

if not exist node_modules (
  echo  [1/4] 처음 실행 - 필요한 프로그램을 설치합니다. 몇 분 걸릴 수 있어요...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo  설치가 한 번 실패했습니다. 남은 파일을 정리하고 다시 시도합니다...
    rmdir /s /q node_modules 2>nul
    del /f /q package-lock.json 2>nul
    call npm install --no-audit --no-fund
    if errorlevel 1 (
      echo.
      echo  [X] 설치에 실패했습니다. 아래를 확인해 주세요.
      echo      1. 인터넷 연결 ^(회사 방화벽이 막고 있을 수 있습니다^)
      echo      2. 이 폴더가 OneDrive/구글드라이브 동기화 폴더 안에 있으면
      echo         C:\orak 처럼 동기화되지 않는 곳으로 옮겨 주세요
      echo      3. 백신이 파일을 잠그는 경우가 있습니다. 잠시 끄고 다시 시도해 보세요
      pause
      exit /b 1
    )
  )
)

echo  [2/4] 환경 점검 중...
call node scripts\doctor.mjs
if errorlevel 1 (
  echo.
  echo  위 항목을 해결한 뒤 start.bat 을 다시 실행하세요.
  pause
  exit /b 1
)

if not exist .next\BUILD_ID (
  echo  [3/4] 프로그램을 빌드합니다. 처음 한 번만 5분 정도 걸립니다...
  call npm run build
  if errorlevel 1 (
    echo  [X] 빌드에 실패했습니다. 화면의 오류 내용을 확인하세요.
    pause
    exit /b 1
  )
)

echo  [4/4] 서버를 시작합니다...
start "" http://localhost:3000
call npm run start
pause
