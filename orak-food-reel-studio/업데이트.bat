@echo off
chcp 65001 >nul
title 오락푸드 스튜디오 - 업데이트
cd /d "%~dp0"

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

for /f "usebackq delims=" %%B in (`git rev-parse --abbrev-ref HEAD`) do set "BRANCH=%%B"
echo  [1/3] 최신 버전을 받아옵니다... ^(브랜치: %BRANCH%^)
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
