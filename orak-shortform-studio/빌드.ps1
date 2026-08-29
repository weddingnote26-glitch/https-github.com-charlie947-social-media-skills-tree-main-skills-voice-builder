# 오락 숏폼 AI 스튜디오 — 배포본 만들기 (Stage 11)
#
#   윈도우 PowerShell 에서:  .\빌드.ps1
#
# 만드는 순서:
#   1) 넣어야 할 것이 다 있는지 확인
#   2) 시험 전부 돌리기          ← 하나라도 실패하면 여기서 멈춥니다
#   3) PyInstaller 로 폴더 만들기
#   4) 만든 것이 진짜 켜지는지 확인
#   5) Inno Setup 으로 설치파일 만들기 (Inno Setup 이 깔려 있으면)

$ErrorActionPreference = "Stop"
$여기 = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $여기

function 알림($글) { Write-Host "`n== $글" -ForegroundColor Cyan }
function 멈춤($글) { Write-Host "`n[멈춤] $글" -ForegroundColor Red; exit 1 }
function 좋음($글) { Write-Host "   $글" -ForegroundColor Green }

# ── 1) 있어야 할 것 ─────────────────────────────────────
알림 "넣어야 할 것이 다 있는지 봅니다"

if (-not (Test-Path ".\.venv\Scripts\python.exe")) {
    멈춤 "가상환경이 없습니다.  py -3.13 -m venv .venv  를 먼저 하세요."
}
$파이썬 = ".\.venv\Scripts\python.exe"

if (-not (Test-Path ".\ffmpeg\ffmpeg.exe")) {
    멈춤 @"
ffmpeg\ffmpeg.exe 가 없습니다.

  1. https://www.gyan.dev/ffmpeg/builds/  에서 release essentials 를 받습니다
  2. 압축을 풀어 bin\ffmpeg.exe 를 이 폴더의 ffmpeg\ 안에 넣습니다
  3. 같이 들어 있는 LICENSE 파일도 ffmpeg\ 안에 넣습니다

  넣지 않고 만들면 담당자 PC 에서 영상이 만들어지지 않습니다.
"@
}
좋음 "ffmpeg.exe 있음"

# 글꼴이 없으면 자막이 네모로 나옵니다. 멈추지는 않고 알리기만 합니다.
if (-not (Test-Path ".\assets\fonts\NotoSansKR-Bold.ttf")) {
    Write-Host "   [주의] assets\fonts\NotoSansKR-Bold.ttf 가 없습니다." -ForegroundColor Yellow
    Write-Host "          자막 글꼴이 담당자 PC 의 것으로 대체됩니다." -ForegroundColor Yellow
}

# 마스터 이미지가 없으면 오락이 장면을 만들 수 없습니다.
$마스터 = @(Get-ChildItem ".\assets\master" -File -Include *.png,*.jpg -ErrorAction SilentlyContinue)
if ($마스터.Count -lt 3) {
    Write-Host "   [주의] 오락이 마스터 이미지가 $($마스터.Count)장뿐입니다 (3장 필요)." -ForegroundColor Yellow
    Write-Host "          오락이가 나오는 장면을 만들 수 없습니다." -ForegroundColor Yellow
}

# ── 2) 시험 ─────────────────────────────────────────────
알림 "시험을 돌립니다 (하나라도 실패하면 멈춥니다)"
$실패 = 0
Get-ChildItem ".\tests\test_*.py" | ForEach-Object {
    & $파이썬 $_.FullName | Select-Object -Last 1 | ForEach-Object {
        Write-Host ("   {0,-24} {1}" -f $_.Name, $_)
        if ($_ -notmatch "0개 실패") { $script:실패++ }
    }
}
if ($실패 -gt 0) { 멈춤 "시험 $실패 개가 실패했습니다. 고친 뒤 다시 하세요." }
좋음 "시험 전부 통과"

# ── 3) 만들기 ───────────────────────────────────────────
알림 "PyInstaller 로 폴더를 만듭니다 (몇 분 걸립니다)"
if (Test-Path ".\dist") { Remove-Item ".\dist" -Recurse -Force }
if (Test-Path ".\build") { Remove-Item ".\build" -Recurse -Force }
& $파이썬 -m PyInstaller ".\오락숏폼스튜디오.spec" --noconfirm
if ($LASTEXITCODE -ne 0) { 멈춤 "만들기가 실패했습니다." }

$나온것 = ".\dist\오락숏폼스튜디오\오락숏폼스튜디오.exe"
if (-not (Test-Path $나온것)) { 멈춤 "exe 가 안 나왔습니다." }
$크기 = [math]::Round((Get-ChildItem ".\dist\오락숏폼스튜디오" -Recurse |
                       Measure-Object -Property Length -Sum).Sum / 1MB, 1)
좋음 "만들었습니다 — $크기 MB"

# ── 4) 진짜 켜지는지 ────────────────────────────────────
알림 "만든 것이 켜지는지 봅니다"
$돌아감 = Start-Process $나온것 -PassThru
Start-Sleep -Seconds 12
if ($돌아감.HasExited) {
    멈춤 "켜자마자 꺼졌습니다 (종료코드 $($돌아감.ExitCode)). 배포하면 안 됩니다."
}
Stop-Process -Id $돌아감.Id -Force
좋음 "12초 동안 잘 떠 있었습니다"

# 비밀이 섞여 들어가지 않았는지
$비밀 = @(Get-ChildItem ".\dist" -Recurse -File -Include *.sqlite3,credentials.dat,.env `
          -ErrorAction SilentlyContinue)
if ($비밀.Count -gt 0) {
    $비밀 | ForEach-Object { Write-Host "   $($_.FullName)" -ForegroundColor Red }
    멈춤 "배포본에 비밀 파일이 들어갔습니다. 배포하면 안 됩니다."
}
좋음 "비밀 파일 없음"

# ── 5) 설치파일 ─────────────────────────────────────────
알림 "설치파일을 만듭니다"
$이노 = @(
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $이노) {
    Write-Host "   Inno Setup 이 없어서 설치파일은 못 만들었습니다." -ForegroundColor Yellow
    Write-Host "   jrsoftware.org/isdl.php 에서 받아 깔고 다시 하세요." -ForegroundColor Yellow
    Write-Host "   (지금도 dist\오락숏폼스튜디오\ 폴더를 통째로 복사하면 씁니다)" -ForegroundColor Yellow
    exit 0
}

& $이노 ".\설치파일.iss"
if ($LASTEXITCODE -ne 0) { 멈춤 "설치파일 만들기가 실패했습니다." }

$설치파일 = Get-ChildItem ".\설치파일_출력\*.exe" | Select-Object -First 1
$설치크기 = [math]::Round($설치파일.Length / 1MB, 1)
Write-Host ""
Write-Host "════════════════════════════════════════" -ForegroundColor Green
Write-Host " 다 됐습니다" -ForegroundColor Green
Write-Host "   $($설치파일.FullName)" -ForegroundColor Green
Write-Host "   $설치크기 MB" -ForegroundColor Green
Write-Host "════════════════════════════════════════" -ForegroundColor Green
