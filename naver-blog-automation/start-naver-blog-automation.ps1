# ═══════════════════════════════════════════════════════════════
#  네이버 블로그 자동화 — 실행
#
#  바탕화면의 "네이버 블로그 자동화 실행" 바로가기가 이 파일을 실행합니다.
#  직접 실행하실 때는 이 파일에서 오른쪽 클릭 → "PowerShell에서 실행".
#
#  이 파일은 프로그램 기능을 고치지 않습니다.
#  실행 환경만 확인하고 원래 메뉴(scripts\menu.py)를 그대로 띄웁니다.
# ═══════════════════════════════════════════════════════════════

param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Passthrough)

# ── 이 파일이 있는 폴더를 기준으로 삼습니다 (폴더를 옮겨도 동작합니다) ──
$Root = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($Root)) {
    $Root = Split-Path -Parent $MyInvocation.MyCommand.Definition
}

# ── 한글이 깨지지 않게 ──────────────────────────────────────
try {
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
    $global:OutputEncoding    = [System.Text.UTF8Encoding]::new()
    $null = chcp 65001
} catch { }
$env:PYTHONIOENCODING = 'utf-8'
$env:PYTHONUTF8       = '1'
try { $Host.UI.RawUI.WindowTitle = '네이버 블로그 자동화' } catch { }

# ── 기록(로그) 준비 ─────────────────────────────────────────
$LogDir = Join-Path $Root 'logs'
if (-not (Test-Path -LiteralPath $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}
$LogFile = Join-Path $LogDir ('실행기록_{0}.log' -f (Get-Date -Format 'yyyy-MM-dd_HHmmss'))

$Transcribing = $false
try {
    Start-Transcript -LiteralPath $LogFile -Force | Out-Null
    $Transcribing = $true
} catch { }

# 30일 지난 실행기록만 정리합니다. (프로그램 자체 로그는 건드리지 않습니다)
try {
    Get-ChildItem -LiteralPath $LogDir -Filter '실행기록_*.log' -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
        Remove-Item -Force -ErrorAction SilentlyContinue
} catch { }


function Show-Line {
    param([string]$Text = '', [string]$Color = 'Gray')
    Write-Host $Text -ForegroundColor $Color
}

function Wait-AndClose {
    param([int]$Code = 0)

    Show-Line
    if ($Code -ne 0) {
        Show-Line '  ──────────────────────────────────────────────────' 'DarkGray'
        Show-Line '  문제가 생겨 멈췄습니다.' 'Yellow'
        Show-Line '  위쪽에 빨간 글씨가 있으면 거기가 원인입니다.'
        Show-Line ''
        Show-Line "  방금 기록: $LogFile"
        Show-Line '  해결 방법: 회사PC_문제해결.md 파일을 열어 보세요.'
        Show-Line '  ──────────────────────────────────────────────────' 'DarkGray'
    }

    if ($Transcribing) { try { Stop-Transcript | Out-Null } catch { } }

    Show-Line
    try { $null = Read-Host '  Enter 를 누르면 창이 닫힙니다' } catch { }
    exit $Code
}


try {
    Show-Line ''
    Show-Line '════════════════════════════════════════════════════════════' 'DarkGray'
    Show-Line '   네이버 블로그 자동화' 'Green'
    Show-Line '════════════════════════════════════════════════════════════' 'DarkGray'
    Show-Line ''
    Show-Line "  프로그램 위치: $Root"
    Show-Line ''

    # ── 1. 프로그램 폴더가 맞는지 ───────────────────────────
    Show-Line '  [1/4] 프로그램 폴더를 확인합니다 …'

    $MenuPy = Join-Path $Root 'scripts\menu.py'
    if (-not (Test-Path -LiteralPath $MenuPy)) {
        Show-Line ''
        Show-Line '  [오류] 프로그램 파일을 찾지 못했습니다.' 'Red'
        Show-Line "         찾은 위치: $MenuPy"
        Show-Line ''
        Show-Line '  이 실행 파일은 naver-blog-automation 폴더 안에 있어야 합니다.'
        Show-Line '  폴더를 옮기셨다면 그 폴더 안의'
        Show-Line '  "바탕화면_바로가기_만들기.ps1" 을 한 번 실행해 주세요.'
        Wait-AndClose 1
    }
    Show-Line '        확인했습니다.'

    # ── 2. 실행 환경(전용 파이썬) 확인 ──────────────────────
    Show-Line '  [2/4] 실행 환경을 확인합니다 …'

    $VenvPy = Join-Path $Root '.venv\Scripts\python.exe'
    if (-not (Test-Path -LiteralPath $VenvPy)) {
        Show-Line ''
        Show-Line '        아직 설치가 안 된 PC입니다. 최초 설치를 먼저 진행합니다.' 'Yellow'
        Show-Line '        (처음 한 번만 하며, 몇 분 걸릴 수 있습니다)'
        Show-Line ''

        $SetupPs1 = Join-Path $Root 'setup.ps1'
        if (-not (Test-Path -LiteralPath $SetupPs1)) {
            Show-Line '  [오류] 설치 파일(setup.ps1)을 찾지 못했습니다.' 'Red'
            Show-Line '         회사PC_처음설치.md 를 보고 수동으로 설치해 주세요.'
            Wait-AndClose 1
        }

        & $SetupPs1

        if (-not (Test-Path -LiteralPath $VenvPy)) {
            Show-Line ''
            Show-Line '  [오류] 최초 설치가 끝나지 않았습니다.' 'Red'
            Show-Line '         파이썬이 없거나, 회사 보안 프로그램이 막았을 수 있습니다.'
            Show-Line '         회사PC_문제해결.md 의 "설치가 안 될 때" 를 봐 주세요.'
            Wait-AndClose 1
        }

        Show-Line ''
        Show-Line '        설치를 마쳤습니다. 이어서 실행합니다.' 'Green'
    }
    Show-Line '        확인했습니다.'

    # ── 3. 설정 파일·폴더 확인 ──────────────────────────────
    Show-Line '  [3/4] 설정을 확인합니다 …'

    $Settings = Join-Path $Root 'config\settings.yaml'
    $Example  = Join-Path $Root 'config\settings.example.yaml'
    if (-not (Test-Path -LiteralPath $Settings)) {
        if (Test-Path -LiteralPath $Example) {
            Copy-Item -LiteralPath $Example -Destination $Settings
            Show-Line '        개인 설정 파일(config\settings.yaml)을 새로 만들었습니다.' 'Yellow'
            Show-Line '        발행 시각 등을 바꾸시려면 메뉴 7번에서 고치시면 됩니다.'
        } else {
            Show-Line ''
            Show-Line '  [오류] 설정 예시 파일이 없습니다.' 'Red'
            Show-Line "         찾은 위치: $Example"
            Show-Line '         깃허브에서 최신본을 다시 받아 주세요. (받아오기.ps1)'
            Wait-AndClose 1
        }
    }

    foreach ($d in @('output', 'logs', 'data\source_cache', 'private\browser-profile')) {
        $p = Join-Path $Root $d
        if (-not (Test-Path -LiteralPath $p)) {
            New-Item -ItemType Directory -Path $p -Force | Out-Null
        }
    }
    Show-Line '        확인했습니다.'

    # ── 4. 프로그램 실행 ────────────────────────────────────
    Show-Line '  [4/4] 프로그램을 시작합니다 …'
    Show-Line ''

    Set-Location -LiteralPath $Root

    if ($Passthrough -and $Passthrough.Count -gt 0) {
        & "$VenvPy" "$MenuPy" @Passthrough
    } else {
        & "$VenvPy" "$MenuPy"
    }

    $Code = $LASTEXITCODE
    if ($null -eq $Code) { $Code = 0 }

    Show-Line ''
    if ($Code -eq 0) {
        Show-Line '  프로그램을 마쳤습니다.' 'Green'
    } else {
        Show-Line "  프로그램이 오류로 끝났습니다. (코드 $Code)" 'Red'
    }

    Wait-AndClose $Code
}
catch {
    Show-Line ''
    Show-Line '  [예상치 못한 오류]' 'Red'
    Show-Line "  $($_.Exception.Message)" 'Red'
    Show-Line ''
    Show-Line '  회사PC_문제해결.md 를 열어 같은 내용이 있는지 확인해 주세요.'
    Wait-AndClose 1
}
