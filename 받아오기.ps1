# ═══════════════════════════════════════════════════════════════
#  깃허브에서 받아오기
#
#  다른 PC에서 한 작업을 이 PC로 가져옵니다.
#  작업을 시작하기 전에 항상 이것부터 실행해 주세요.
#
#  이 파일을 마우스 오른쪽 클릭 → "PowerShell에서 실행"
# ═══════════════════════════════════════════════════════════════

try {
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
    $null = chcp 65001
} catch { }

$Root = $PSScriptRoot
Set-Location -LiteralPath $Root

Write-Host ''
Write-Host '════════════════════════════════════════════════════════════'
Write-Host '   깃허브에서 받아오기'
Write-Host '════════════════════════════════════════════════════════════'
Write-Host ''

$git = Get-Command git -ErrorAction SilentlyContinue
if (-not $git) {
    Write-Host '  [오류] git 이 설치되어 있지 않습니다.' -ForegroundColor Red
    Write-Host '        https://git-scm.com/download/win 에서 설치해 주세요.'
    Write-Host ''
    Read-Host '  Enter 를 누르면 창이 닫힙니다'
    exit 1
}

if (-not (Test-Path -LiteralPath (Join-Path $Root '.git'))) {
    Write-Host '  [오류] 여기는 작업 폴더가 아닙니다.' -ForegroundColor Red
    Write-Host "        지금 위치: $Root"
    Write-Host ''
    Read-Host '  Enter 를 누르면 창이 닫힙니다'
    exit 1
}

# 아직 올리지 않은 작업이 있는지 먼저 확인합니다.
$changed = git status --porcelain
if ($changed) {
    Write-Host '  [확인 필요] 이 PC에 아직 올리지 않은 변경이 있습니다.' -ForegroundColor Yellow
    Write-Host ''
    $changed | Select-Object -First 10 | ForEach-Object { Write-Host "    $_" }
    Write-Host ''
    Write-Host '  그냥 받아오면 이 내용과 부딪칠 수 있습니다.'
    Write-Host '  먼저 "올리기.ps1" 로 올린 뒤 받아오시는 편이 안전합니다.'
    Write-Host ''
    $ans = Read-Host '  그래도 받아올까요? (y/N)'
    if ($ans -notmatch '^[Yy예네ㅇ]') {
        Write-Host '  취소했습니다.'
        Write-Host ''
        Read-Host '  Enter 를 누르면 창이 닫힙니다'
        exit 0
    }
    Write-Host ''
}

$branch = (git rev-parse --abbrev-ref HEAD).Trim()
Write-Host "  브랜치 : $branch"
Write-Host '  받아오는 중 …'
Write-Host ''

git pull --no-rebase origin $branch

if ($LASTEXITCODE -eq 0) {
    Write-Host ''
    Write-Host '════════════════════════════════════════════════════════════'
    Write-Host '   받아오기 완료' -ForegroundColor Green
    Write-Host '════════════════════════════════════════════════════════════'
    Write-Host ''
    Write-Host '  이 PC에서 처음이시라면 아래를 한 번 실행해 주세요:'
    Write-Host '    naver-blog-automation\setup.ps1' -ForegroundColor Cyan
    Write-Host ''
    Write-Host '  그다음부터는 run.ps1 로 바로 시작하시면 됩니다.'
    Write-Host ''
    Write-Host '  Claude 에게는 이렇게 말씀하세요:'
    Write-Host '    "WORKLOG 읽고 이어서 해줘"' -ForegroundColor Cyan
} else {
    Write-Host ''
    Write-Host '  [실패] 받아오지 못했습니다.' -ForegroundColor Red
    Write-Host ''
    Write-Host '  "CONFLICT" 라는 말이 보이면 양쪽에서 같은 파일을 고친 것입니다.'
    Write-Host '  Claude 에게 위 내용을 그대로 보여주시면 정리해 드립니다.'
}

Write-Host ''
Read-Host '  Enter 를 누르면 창이 닫힙니다'
