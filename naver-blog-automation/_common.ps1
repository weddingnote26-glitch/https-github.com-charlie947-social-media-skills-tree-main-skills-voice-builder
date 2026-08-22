# ═══════════════════════════════════════════════════════════════
#  공통 함수 — 다른 ps1 파일들이 불러다 씁니다.
#  이 파일을 직접 실행하실 필요는 없습니다.
# ═══════════════════════════════════════════════════════════════

function Initialize-Console {
    # Windows 기본 인코딩(CP949)에서 한글이 깨지지 않게 합니다.
    try {
        [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
        $global:OutputEncoding = [System.Text.UTF8Encoding]::new()
        $null = chcp 65001
    } catch { }
    $env:PYTHONIOENCODING = 'utf-8'
    $env:PYTHONUTF8 = '1'
}

function Get-ProjectPython {
    param([Parameter(Mandatory = $true)][string]$Root)

    $venvPy = Join-Path $Root '.venv\Scripts\python.exe'
    if (Test-Path -LiteralPath $venvPy) { return $venvPy }

    Write-Host ''
    Write-Host '  [확인 필요] 전용 환경이 없습니다.' -ForegroundColor Yellow
    Write-Host '              setup.ps1 을 먼저 한 번 실행해 주세요.'
    Write-Host '              일단 시스템 파이썬으로 시도합니다.'
    Write-Host ''

    foreach ($cand in @('python', 'py', 'python3')) {
        $found = Get-Command $cand -ErrorAction SilentlyContinue
        if ($found) { return $found.Source }
    }
    return $null
}

function Invoke-BlogScript {
    <#
      scripts\ 폴더의 파이썬 파일을 실행합니다.
      경로에 한글이나 공백이 있어도 동작하도록 따옴표를 붙여 넘깁니다.
    #>
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [Parameter(Mandatory = $true)][string]$Script,
        [string[]]$ScriptArgs = @()
    )

    Initialize-Console
    Set-Location -LiteralPath $Root

    $py = Get-ProjectPython -Root $Root
    if (-not $py) {
        Write-Host '  [오류] 파이썬을 찾지 못했습니다.' -ForegroundColor Red
        Write-Host '        https://www.python.org/downloads/ 에서 설치해 주세요.'
        return 1
    }

    $target = Join-Path $Root (Join-Path 'scripts' $Script)
    if (-not (Test-Path -LiteralPath $target)) {
        Write-Host "  [오류] 파일을 찾을 수 없습니다: $target" -ForegroundColor Red
        return 1
    }

    if ($ScriptArgs -and $ScriptArgs.Count -gt 0) {
        & "$py" "$target" @ScriptArgs
    } else {
        & "$py" "$target"
    }
    return $LASTEXITCODE
}

function Wait-BeforeClose {
    Write-Host ''
    $null = Read-Host '  Enter 를 누르면 창이 닫힙니다'
}
