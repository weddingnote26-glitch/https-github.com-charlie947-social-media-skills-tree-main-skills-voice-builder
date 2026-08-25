@echo off
chcp 65001 >nul
title 오락푸드 AI릴스 스튜디오 - 설치 파일 만들기
cd /d "%~dp0"

rem ── 여기가 소스 폴더가 맞는지 먼저 본다 ──────────────────
rem 설치된 프로그램 안(resources\app)에서 누르면 scripts 폴더가 없어
rem node 가 "Cannot find module ..." 이라는 알 수 없는 말로 죽는다.
rem 그 전에 사람 말로 막는다.
if not exist "%CD%\package.json" goto WRONG_PLACE
if not exist "%CD%\scripts\" goto WRONG_PLACE
if not exist "%CD%\src\" goto WRONG_PLACE
goto PLACE_OK

:WRONG_PLACE
echo.
echo  ================================================
echo    여기서는 실행할 수 없습니다
echo  ================================================
echo.
echo   지금 자리: %CD%
echo.
echo   이 파일은 "프로그램 소스 폴더" 에서만 동작합니다.
echo   설치된 프로그램 폴더 안에서 누르면 필요한 파일이 없어 실패합니다.
echo.
echo   소스 폴더는 start.bat 과 scripts 폴더가 같이 있는 곳입니다.
echo   보통 이런 자리입니다:
echo     %USERPROFILE%\Documents\블로그작업\orak-food-reel-studio
echo.
if exist "%USERPROFILE%\Documents\블로그작업\orak-food-reel-studio\package.json" goto OFFER
echo   * 그 폴더를 찾으시면 그 안의 같은 이름 파일을 실행해 주세요.
echo.
pause
exit /b 1

:OFFER
echo   [i] 소스 폴더를 찾았습니다. 탐색기로 열어 드리겠습니다.
echo       그 안의 같은 이름 파일을 눌러 주세요.
echo.
start "" "%USERPROFILE%\Documents\블로그작업\orak-food-reel-studio"
pause
exit /b 1

:PLACE_OK

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
call node scripts\cloud-warn.mjs
echo  [4/6] 지난 결과를 정리하고 프로그램을 빌드합니다. 3~5분 걸립니다...
if exist dist-app rmdir /s /q dist-app
if exist dist-bin rmdir /s /q dist-bin
if exist dist-installer rmdir /s /q dist-installer
call npm run build
if errorlevel 1 (
  echo  [X] 빌드에 실패했습니다.
  echo.
  echo      화면에 "EPERM" 또는 "Permission denied" 가 보이면
  echo      다른 프로그램이 파일을 붙잡고 있는 것입니다. 아래를 닫고 다시 실행하세요.
  echo        1^) 오락푸드 AI릴스 프로그램 ^(작업 표시줄도 확인^)
  echo        2^) 검은 명령창
  echo        3^) 이 폴더를 열어 둔 탐색기 창
  echo        4^) OneDrive · 구글드라이브 동기화 ^(잠시 멈춤^)
  echo.
  echo      그래도 안 되면 화면 내용을 그대로 복사해 Claude 에게 보여주세요.
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
echo.
call npx electron-builder --win --x64
if not errorlevel 1 goto BUILD_OK

echo.
echo  [!] 한 번 실패했습니다. 코드 서명 도구 문제일 수 있어 정리하고 다시 시도합니다...
echo.
call node scripts\fix-builder-cache.mjs
echo.
call npx electron-builder --win --x64
if not errorlevel 1 goto BUILD_OK

echo.
echo  [X] 설치 파일 만들기에 실패했습니다.
echo.
echo      화면에 "Cannot create symbolic link" 또는 "권한이 없습니다" 가 보이면
echo      아래 둘 중 하나로 해결됩니다.
echo.
echo      1^) 개발자 모드 켜기 ^(권장, 한 번만^)
echo         설정 - 개인 정보 및 보안 - 개발자용 - 개발자 모드 켬
echo         그다음 이 파일을 다시 실행하세요.
echo.
echo      2^) 이 파일을 마우스 오른쪽 클릭 - 관리자 권한으로 실행
echo.
echo      * 설치 파일을 못 만들어도 프로그램은 start.bat 으로 계속 쓸 수 있습니다.
echo.
pause
exit /b 1

:BUILD_OK
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
