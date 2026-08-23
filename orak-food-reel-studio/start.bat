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

REM .env 의 APP_PORT 를 읽어 PORT 환경변수로 (없으면 3000)
set "PORT=3000"
for /f "usebackq delims=" %%P in (`node scripts\port.mjs`) do set "PORT=%%P"

REM 코드를 새로 받았는데 예전 빌드가 남아 있으면 옛 화면이 그대로 돈다.
REM 소스가 빌드 결과보다 새로우면 반드시 다시 빌드한다.
call node scripts\needs-build.mjs
if errorlevel 1 (
  echo  [3/4] 프로그램을 빌드합니다. 3~5분 걸립니다...
  call npm run build
  if errorlevel 1 (
    echo  [X] 빌드에 실패했습니다. 화면의 오류 내용을 확인하세요.
    pause
    exit /b 1
  )
) else (
  echo  [3/4] 빌드가 최신입니다. 건너뜁니다.
)

echo.
echo  [4/4] 서버를 시작합니다...
echo.
echo      주소: http://localhost:%PORT%
echo      서버가 준비되면 브라우저가 자동으로 열립니다. ^(10~30초^)
echo      * 이 검은 창을 닫으면 프로그램이 종료됩니다. 사용 중에는 닫지 마세요.
echo.

REM 서버가 실제로 응답할 때까지 기다렸다가 브라우저 열기 (너무 일찍 열면 "연결 거부"가 납니다)
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "$u='http://localhost:%PORT%'; for($i=0; $i -lt 180; $i++){ try { $null = Invoke-WebRequest $u -UseBasicParsing -TimeoutSec 2; Start-Process $u; break } catch { Start-Sleep -Seconds 1 } }"

call npm run start
echo.
echo  서버가 종료되었습니다.
pause
