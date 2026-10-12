@echo off
chcp 65001 >nul
title 오락푸드 스튜디오 - 업데이트
cd /d "%~dp0"

rem ── 여기가 소스 폴더가 맞는지 먼저 본다 ──────────────────
rem 설치된 프로그램 안(resources\app)에서 누르면 scripts 폴더가 없어
rem node 가 "Cannot find module ..." 이라는 알 수 없는 말로 죽는다.
rem 그 전에 사람 말로 막는다.
rem
rem * 이 파일의 if 문은 전부 goto 방식이다. 괄호 ( ) 블록 안에 한글을 넣으면
rem   cmd 가 블록을 읽으며 "'??'은(는) 내부 또는 외부 명령이 아닙니다" 라는
rem   가짜 오류를 찍는다 — 실제로 매번 두 줄씩 떠서 사용자를 놀라게 했다.
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
if errorlevel 1 goto NO_GIT

REM 작업 기록(.git)은 이 폴더의 한 단계 위에 있습니다.
pushd "%~dp0.."
if not exist ".git" goto NO_REPO

rem ── 지난번에 받다가 멈춘 흔적이 남아 있으면 먼저 원래대로 되돌린다 ──
rem 이 흔적(MERGE_HEAD)이 남아 있으면 어떤 업데이트도 "unmerged files" 라며
rem 시작조차 못 한다 — 실제로 두 번 겪었다. 받던 것만 취소될 뿐 파일은 잃지 않는다.
if not exist ".git\MERGE_HEAD" goto CLEAN_OK
echo  [i] 지난번 받다가 멈춘 상태가 남아 있어 원래대로 되돌립니다...
git merge --abort
if errorlevel 1 goto HEAL_FAIL
echo      되돌렸습니다. 이어서 진행합니다.
echo.

:CLEAN_OK
REM 릴스 스튜디오 작업이 올라가는 갈래(branch). 다른 갈래를 보고 있으면
REM "이미 최신입니다" 만 나오고 새 작업이 하나도 오지 않는다 — 실제로 겪은 일이다.
set "WANT=claude/orak-food-reel-studio-2kux9t"
set "REELS_DONE=0"

set "BRANCH="
for /f "usebackq delims=" %%B in (`git rev-parse --abbrev-ref HEAD`) do set "BRANCH=%%B"
if /i "%BRANCH%"=="%WANT%" goto BRANCH_OK

rem 다른 갈래를 보고 있어도 옮기지 않는다.
rem 이 폴더에는 블로그 프로젝트도 같이 있어서, 갈래를 옮기면 그쪽이
rem 예전 상태로 되돌아간다. 옮기는 대신 릴스 작업만 끌어와 합친다.
echo  [!] 지금 폴더는 다른 갈래를 보고 있습니다.
echo        지금 보는 것 : %BRANCH%
echo        릴스 작업    : %WANT%
echo      갈래는 그대로 두고, 릴스 스튜디오 작업만 합쳐 옵니다.
echo      ^(블로그 폴더는 건드리지 않습니다^)
echo.
git fetch origin %WANT%
if errorlevel 1 goto NET_FAIL
git merge --no-edit origin/%WANT%
if errorlevel 1 goto REELS_CONFLICT
set "REELS_DONE=1"
echo  [i] 릴스 스튜디오 작업을 %BRANCH% 에 합쳤습니다.
echo.

:BRANCH_OK
echo  [1/3] 최신 버전을 받아옵니다... ^(갈래: %BRANCH%^)
echo.
git pull --no-rebase origin %BRANCH%
if errorlevel 1 goto PULL_FAIL
goto PULL_DONE

:PULL_FAIL
rem 받다가 충돌로 멈췄으면 흔적을 치워 둔다 — 그대로 두면
rem 다음 실행까지 전부 막아 버리는 덫이 된다 (파일은 잃지 않는다).
if exist ".git\MERGE_HEAD" git merge --abort
if "%REELS_DONE%"=="1" goto PULL_SKIP
echo.
echo  [X] 받아오지 못했습니다.
echo      위에 CONFLICT 라고 적혀 있으면 양쪽에서 같은 파일을 고친 것입니다.
echo      화면 내용을 그대로 복사해 Claude 에게 보여주세요.
popd
pause
exit /b 1

:PULL_SKIP
rem 릴스 작업은 위에서 이미 합쳐졌다. 여기서 막힌 것은 블로그 쪽 파일이라
rem 릴스 스튜디오와 무관하다 — 알리기만 하고 계속 간다.
echo.
echo  [!] 블로그 폴더 쪽 파일이 양쪽에서 달라 그 부분은 받지 못했습니다.
echo      릴스 스튜디오와는 무관하므로 이 업데이트는 계속 진행합니다.
echo      ^(블로그 받기는 블로그 작업할 때 따로 정리하면 됩니다^)
echo.

:PULL_DONE
echo.
REM 무엇을 받았는지 눈으로 확인할 수 있게 (설정 화면의 [프로그램 정보] 와 같은 값)
echo  [i] 지금 받은 것:
git log -1 --oneline
popd

echo.
echo  [2/3] 필요한 프로그램을 맞춥니다...
call npm install --no-audit --no-fund
if errorlevel 1 goto NPM_FAIL

echo.
echo  * 오락푸드 프로그램이 켜져 있으면 지금 닫아 주세요 ^(파일이 잠깁니다^)
call node scripts\cloud-warn.mjs
echo.
echo  [3/3] 프로그램을 새로 만듭니다. 3~5분 걸립니다...
call npm run fresh
if errorlevel 1 goto BUILD_FAIL

echo.
echo  ================================================
echo    업데이트 완료 - 이어서 프로그램을 시작합니다
echo  ================================================
echo.
call "%~dp0start.bat"
exit /b 0

rem ────────────────── 아래는 실패했을 때만 ──────────────────

:NO_GIT
echo  [X] git 이 설치되어 있지 않습니다.
echo      https://git-scm.com/download/win 에서 설치한 뒤 다시 실행하세요.
pause
exit /b 1

:NO_REPO
echo  [X] 작업 폴더를 찾지 못했습니다.
echo      현재 위치: %CD%
echo      이 파일은 start.bat 과 같은 폴더에 있어야 합니다.
popd
pause
exit /b 1

:HEAL_FAIL
echo  [X] 되돌리지 못했습니다. 화면 내용을 그대로 복사해 Claude 에게 보여주세요.
popd
pause
exit /b 1

:NET_FAIL
echo  [X] 인터넷에서 받아오지 못했습니다. 연결과 회사 방화벽을 확인해 주세요.
popd
pause
exit /b 1

:REELS_CONFLICT
rem 릴스 폴더 자체가 양쪽에서 달라진 경우 — 반쯤 합쳐진 채 두지 않고 되돌린 뒤 멈춘다.
if exist ".git\MERGE_HEAD" git merge --abort
echo.
echo  [X] 릴스 작업을 합치는 중 충돌이 나서 원래 상태로 되돌려 두었습니다.
echo      ^(파일을 잃지는 않았습니다^)
echo      화면 내용을 그대로 복사해 Claude 에게 보여주세요.
popd
pause
exit /b 1

:NPM_FAIL
echo  [X] 설치에 실패했습니다. 화면의 오류 내용을 확인하세요.
pause
exit /b 1

:BUILD_FAIL
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
