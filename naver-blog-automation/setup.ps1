# ═══════════════════════════════════════════════════════════════
#  최초 설치 — PC마다 딱 한 번만 실행하면 됩니다.
#
#  실행 방법
#    이 파일에서 마우스 오른쪽 → "PowerShell에서 실행"
#    또는 PowerShell 창에서:  .\setup.ps1
#
#  "이 시스템에서 스크립트를 실행할 수 없으므로" 라는 오류가 나오면
#  PowerShell 창에 아래를 한 번 입력한 뒤 다시 실행해 주세요.
#    Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
# ═══════════════════════════════════════════════════════════════

$ErrorActionPreference = 'Stop'

# 한글이 깨지지 않게 합니다.
try {
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
    $OutputEncoding = [System.Text.UTF8Encoding]::new()
    chcp 65001 > $null
} catch { }

$Root = $PSScriptRoot
Set-Location -LiteralPath $Root

Write-Host ''
Write-Host '════════════════════════════════════════════════════════════'
Write-Host '   네이버 블로그 콘텐츠 도우미 — 최초 설치'
Write-Host '════════════════════════════════════════════════════════════'
Write-Host ''
Write-Host "  설치 위치: $Root"
Write-Host ''

# ── 1. 파이썬 찾기 ────────────────────────────────────────
Write-Host '  [1/5] 파이썬을 찾는 중 …'

$PyCmd = $null
foreach ($cand in @('py', 'python', 'python3')) {
    try {
        $ver = & $cand --version 2>&1
        if ($LASTEXITCODE -eq 0 -and "$ver" -match 'Python 3\.(\d+)') {
            if ([int]$Matches[1] -ge 9) {
                $PyCmd = $cand
                Write-Host "        찾았습니다: $ver"
                break
            }
        }
    } catch { }
}

if (-not $PyCmd) {
    Write-Host ''
    Write-Host '  [오류] 파이썬 3.9 이상을 찾지 못했습니다.' -ForegroundColor Red
    Write-Host ''
    Write-Host '        https://www.python.org/downloads/ 에서 내려받아 설치해 주세요.'
    Write-Host '        설치할 때 "Add Python to PATH" 를 꼭 체크하세요.'
    Write-Host ''
    Read-Host '  Enter 를 누르면 창이 닫힙니다'
    exit 1
}

# ── 2. 전용 파이썬 환경 만들기 ────────────────────────────
Write-Host '  [2/5] 이 프로젝트 전용 환경을 만드는 중 …'

$VenvDir = Join-Path $Root '.venv'
$VenvPy  = Join-Path $VenvDir 'Scripts\python.exe'

if (-not (Test-Path -LiteralPath $VenvPy)) {
    & $PyCmd -m venv "$VenvDir"
    if ($LASTEXITCODE -ne 0) {
        Write-Host '  [오류] 전용 환경을 만들지 못했습니다.' -ForegroundColor Red
        Read-Host '  Enter 를 누르면 창이 닫힙니다'
        exit 1
    }
    Write-Host '        만들었습니다.'
} else {
    Write-Host '        이미 있습니다. 그대로 씁니다.'
}

# ── 3. 필요한 프로그램 설치 ───────────────────────────────
Write-Host '  [3/5] 필요한 프로그램을 설치하는 중 … (몇 분 걸릴 수 있습니다)'

& "$VenvPy" -m pip install --upgrade pip --quiet
& "$VenvPy" -m pip install -r (Join-Path $Root 'requirements.txt') --quiet
if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host '  [확인 필요] 일부 설치에 실패했습니다.' -ForegroundColor Yellow
    Write-Host '              인터넷 연결이나 회사 보안 프로그램 때문일 수 있습니다.'
    Write-Host '              핵심 기능은 동작할 수 있으니 계속 진행합니다.'
} else {
    Write-Host '        설치를 마쳤습니다.'
}

# ── 4. 개인 설정 파일 만들기 ──────────────────────────────
Write-Host '  [4/5] 개인 설정 파일을 준비하는 중 …'

$SettingsPath = Join-Path $Root 'config\settings.yaml'
$ExamplePath  = Join-Path $Root 'config\settings.example.yaml'

if (-not (Test-Path -LiteralPath $SettingsPath)) {
    Copy-Item -LiteralPath $ExamplePath -Destination $SettingsPath
    Write-Host '        config\settings.yaml 을 만들었습니다.'

    Write-Host ''
    $machine = Read-Host '        이 PC를 뭐라고 부를까요? (예: 집 / 회사)'
    if ([string]::IsNullOrWhiteSpace($machine)) { $machine = '내 PC' }

    $content = Get-Content -LiteralPath $SettingsPath -Raw -Encoding UTF8
    $content = $content -replace 'machine_name:\s*".*"', ('machine_name: "' + $machine + '"')
    # BOM 없는 UTF-8 로 저장합니다.
    [System.IO.File]::WriteAllText($SettingsPath, $content, [System.Text.UTF8Encoding]::new($false))
    Write-Host "        이 PC 이름을 '$machine' 으로 저장했습니다."
} else {
    Write-Host '        이미 있습니다. 그대로 씁니다.'
}

# ── 5. 폴더 만들기 ────────────────────────────────────────
Write-Host '  [5/5] 폴더를 확인하는 중 …'

foreach ($d in @('output', 'logs', 'data\source_cache', 'private\browser-profile')) {
    $p = Join-Path $Root $d
    if (-not (Test-Path -LiteralPath $p)) {
        New-Item -ItemType Directory -Path $p -Force | Out-Null
    }
}
Write-Host '        확인했습니다.'

# ── 마무리 ────────────────────────────────────────────────
Write-Host ''
Write-Host '════════════════════════════════════════════════════════════'
Write-Host '   설치가 끝났습니다.'
Write-Host '════════════════════════════════════════════════════════════'
Write-Host ''
Write-Host '  이제 run.ps1 을 실행하면 메뉴가 나옵니다.'
Write-Host ''
Write-Host '  ⚠ 아직 두 블로그의 글 양식이 분석되지 않았습니다.'
Write-Host '     Claude Code에게 대표 게시물 3~5편을 보여 주고'
Write-Host '     "config/style_coin.md 를 이 샘플로 분석해서 채워줘"'
Write-Host '     라고 말하면 분석해 줍니다.'
Write-Host ''
Write-Host '  ⚠ private 폴더와 config\settings.yaml 은 동기화되지 않습니다.'
Write-Host '     로그인 정보가 밖으로 나가지 않도록 일부러 그렇게 했습니다.'
Write-Host ''
Read-Host '  Enter 를 누르면 창이 닫힙니다'
