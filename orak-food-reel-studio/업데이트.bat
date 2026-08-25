@echo off
chcp 65001 >nul
title 오락푸드 스튜디오 - 업데이트
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
echo    오락푸드 AI 릴스 스튜디오 - 업데이트
echo    최신 버전을 받아 다시 만든 뒤 바로 실행합니다
echo  ================================================
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo  [X] git 이 설치되어 있지 않습니다.
  echo      https://git-scm.com/download/win 에서 설치한 뒤 다시 실행하세요.
  pause
  exit /b 1
)

REM 작업 기록(.git)은 이 폴더의 한 단계 위에 있습니다.
pushd "%~dp0.."
if not exist ".git" (
  echo  [X] 작업 폴더를 찾지 못했습니다.
  echo      현재 위치: %CD%
  echo      이 파일은 start.bat 과 같은 폴더에 있어야 합니다.
  popd
  pause
  exit /b 1
)

REM 릴스 스튜디오 작업이 올라가는 갈래(branch). 다른 갈래를 보고 있으면
REM "이미 최신입니다" 만 나오고 새 작업이 하나도 오지 않는다 — 실제로 겪은 일이다.
set "WANT=claude/orak-food-reel-studio-2kux9t"

set "BRANCH="
for /f "usebackq delims=" %%B in (`git rev-parse --abbrev-ref HEAD`) do set "BRANCH=%%B"
if /i "%BRANCH%"=="%WANT%" goto BRANCH_OK

echo  [!] 지금 폴더가 다른 갈래를 보고 있습니다.
echo        지금 보는 것 : %BRANCH%
echo        받아야 할 것 : %WANT%
echo      이대로 두면 새 작업이 하나도 오지 않아서 %WANT% 로 옮깁니다.
echo.
git fetch origin %WANT%
git checkout %WANT%
if not errorlevel 1 goto BRANCH_MOVED

echo.
echo  [X] 갈래를 옮기지 못했습니다. 이 폴더에서 고친 파일이 있을 수 있습니다.
echo      화면 내용을 그대로 복사해 Claude 에게 보여주세요.
popd
pause
exit /b 1

:BRANCH_MOVED
set "BRANCH=%WANT%"
echo  [i] %WANT% 로 옮겼습니다.
echo.

:BRANCH_OK
echo  [1/3] 최신 버전을 받아옵니다... ^(갈래: %BRANCH%^)
echo.
git pull --no-rebase origin %BRANCH%
if errorlevel 1 (
  echo.
  echo  [X] 받아오지 못했습니다.
  echo      위에 CONFLICT 라고 적혀 있으면 양쪽에서 같은 파일을 고친 것입니다.
  echo      화면 내용을 그대로 복사해 Claude 에게 보여주세요.
  popd
  pause
  exit /b 1
)
echo.
REM 무엇을 받았는지 눈으로 확인할 수 있게 (설정 화면의 [프로그램 정보] 와 같은 값)
echo  [i] 지금 받은 것:
git log -1 --oneline
popd

echo.
echo  [2/3] 필요한 프로그램을 맞춥니다...
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo  [X] 설치에 실패했습니다. 화면의 오류 내용을 확인하세요.
  pause
  exit /b 1
)

echo.
echo  * 오락푸드 프로그램이 켜져 있으면 지금 닫아 주세요 ^(파일이 잠깁니다^)
call node scripts\cloud-warn.mjs
echo.
echo  [3/3] 프로그램을 새로 만듭니다. 3~5분 걸립니다...
call npm run fresh
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
echo  ================================================
echo    업데이트 완료 - 이어서 프로그램을 시작합니다
echo  ================================================
echo.
call "%~dp0start.bat"
