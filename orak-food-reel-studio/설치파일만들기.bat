@echo off
chcp 65001 >nul
title 오락푸드 AI릴스 스튜디오 - 설치 파일 만들기
cd /d "%~dp0"

echo.
echo  ================================================
echo    오락푸드 AI릴스 자동제작 스튜디오
echo    설치 파일(.exe) 만들기
echo  ================================================
echo.
echo   이 창은 설치 파일을 "만드는" 창입니다.
echo   다 만들어지면 그 파일을 실행해서 설치하시면 됩니다.
echo   처음에는 10~20분 걸릴 수 있습니다.
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo  [X] Node.js가 설치되어 있지 않습니다.
  echo      https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행하세요.
  pause
  exit /b 1
)

echo  [1/6] 필요한 프로그램을 설치합니다...
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo  [X] 설치에 실패했습니다. 인터넷 연결과 회사 방화벽을 확인해 주세요.
  pause
  exit /b 1
)

echo.
echo  [2/6] 설치 파일 제작 도구를 준비합니다. 100MB 넘게 받으므로 5~10분 걸립니다...
call npm run desktop:tools
if errorlevel 1 (
  echo.
  echo  [X] 제작 도구를 받지 못했습니다.
  echo      회사 방화벽이 github.com 을 막고 있을 수 있습니다.
  echo      * 이 단계가 실패해도 프로그램 자체는 start.bat 으로 계속 쓸 수 있습니다.
  pause
  exit /b 1
)

echo.
echo  [3/6] FFmpeg를 확인합니다...
call node scripts\fix-ffmpeg.mjs
if errorlevel 1 (
  echo.
  echo  [!] FFmpeg를 준비하지 못했습니다.
  echo      이대로 만들면 설치본에서 영상을 만들 수 없습니다.
  echo      위 안내를 따라 해결한 뒤 다시 실행해 주세요.
  pause
  exit /b 1
)

echo.
echo  [4/6] 프로그램을 빌드합니다. 3~5분 걸립니다...
call npm run build
if errorlevel 1 (
  echo  [X] 빌드에 실패했습니다. 화면의 오류 내용을 확인하세요.
  pause
  exit /b 1
)

echo.
echo  [5/6] 설치본에 넣을 파일을 고릅니다 ^(비밀값 검사 포함^)...
call node scripts\prepare-desktop.mjs
if errorlevel 1 (
  echo  [X] 준비에 실패했습니다. 위 내용을 확인하세요.
  pause
  exit /b 1
)

echo.
echo  [6/6] 설치 파일을 만듭니다. 5~15분 걸립니다...
call npx electron-builder --win --x64
if errorlevel 1 (
  echo  [X] 설치 파일 만들기에 실패했습니다. 화면의 오류 내용을 확인하세요.
  pause
  exit /b 1
)

echo.
echo  ================================================
echo    완료
echo  ================================================
echo.
echo   설치 파일이 아래 폴더에 있습니다:
echo   %CD%\dist-installer
echo.
echo   그 안의
echo   [오락푸드-AI릴스-자동제작-스튜디오-Setup-x64.exe]
echo   를 두 번 눌러 설치하세요.
echo.
echo   * 코드 서명 인증서가 없어 Windows가 경고를 띄울 수 있습니다.
echo     [추가 정보] - [실행] 을 누르시면 됩니다.
echo.
start "" "%CD%\dist-installer"
pause
