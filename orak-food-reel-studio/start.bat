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
    echo  [X] 설치에 실패했습니다. 인터넷 연결을 확인하고 다시 실행하세요.
    pause
    exit /b 1
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
