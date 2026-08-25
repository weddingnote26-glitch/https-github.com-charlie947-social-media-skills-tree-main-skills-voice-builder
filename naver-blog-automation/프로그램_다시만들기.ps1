# ═══════════════════════════════════════════════════════════════
#  프로그램 다시 만들기 (개발자용)
#
#  화면이나 기능을 고친 뒤 실행파일을 새로 만들 때 씁니다.
#  평소 쓰실 때는 이 파일이 필요 없습니다.
#
#  오른쪽 클릭 → "PowerShell에서 실행"
# ═══════════════════════════════════════════════════════════════

try {
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
    $global:OutputEncoding    = [System.Text.UTF8Encoding]::new()
    $null = chcp 65001
} catch { }

$Root = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($Root)) {
    $Root = Split-Path -Parent $MyInvocation.MyCommand.Definition
}
Set-Location -LiteralPath $Root

$Py = Join-Path $Root '.venv\Scripts\python.exe'

Write-Host ''
Write-Host '════════════════════════════════════════════════════════════'
Write-Host '   네이버 블로그 도우미 — 다시 만들기'
Write-Host '════════════════════════════════════════════════════════════'
Write-Host ''

if (-not (Test-Path -LiteralPath $Py)) {
    Write-Host '  [오류] 전용 파이썬 환경이 없습니다.' -ForegroundColor Red
    Write-Host '         먼저 setup.ps1 을 한 번 실행해 주세요.'
    $null = Read-Host '  Enter 를 누르면 창이 닫힙니다'
    exit 1
}

Write-Host '  [1/3] 필요한 것이 다 있는지 확인합니다 …'
& $Py -m pip install --quiet PySide6 pyinstaller
if ($LASTEXITCODE -ne 0) {
    Write-Host '  [오류] 설치에 실패했습니다. 인터넷 연결을 확인해 주세요.' -ForegroundColor Red
    $null = Read-Host '  Enter 를 누르면 창이 닫힙니다'
    exit 1
}

Write-Host '  [2/3] 실행파일을 만듭니다 … (몇 분 걸립니다)'
& $Py -m PyInstaller --noconfirm --clean '네이버블로그도우미.spec'
if ($LASTEXITCODE -ne 0) {
    Write-Host '  [오류] 만들지 못했습니다. 위 내용을 확인해 주세요.' -ForegroundColor Red
    $null = Read-Host '  Enter 를 누르면 창이 닫힙니다'
    exit 1
}

Write-Host '  [3/3] 바로가기를 새로 만듭니다 …'
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root '바탕화면_바로가기_만들기.ps1')

$Exe = Join-Path $Root 'dist\네이버블로그도우미\네이버블로그도우미.exe'
Write-Host ''
if (Test-Path -LiteralPath $Exe) {
    Write-Host '  다 만들었습니다.' -ForegroundColor Green
    Write-Host "  $Exe"
} else {
    Write-Host '  [오류] 실행파일이 만들어지지 않았습니다.' -ForegroundColor Red
}
Write-Host ''
$null = Read-Host '  Enter 를 누르면 창이 닫힙니다'
