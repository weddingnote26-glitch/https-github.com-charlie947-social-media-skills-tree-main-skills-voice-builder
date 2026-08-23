# ═══════════════════════════════════════════════════════════════
#  바탕화면 바로가기 만들기
#
#  이 파일에서 오른쪽 클릭 → "PowerShell에서 실행" 하시면
#  바탕화면에 "네이버 블로그 자동화 실행" 바로가기가 생깁니다.
#
#  폴더를 다른 곳으로 옮기셨을 때도 이 파일을 다시 실행하시면
#  바로가기가 새 위치를 가리키도록 고쳐집니다.
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

$LinkName = '네이버 블로그 자동화 실행'

Write-Host ''
Write-Host '════════════════════════════════════════════════════════════'
Write-Host '   바탕화면 바로가기 만들기'
Write-Host '════════════════════════════════════════════════════════════'
Write-Host ''

try {
    $Target = Join-Path $Root 'start-naver-blog-automation.bat'
    if (-not (Test-Path -LiteralPath $Target)) {
        Write-Host '  [오류] start-naver-blog-automation.bat 을 찾지 못했습니다.' -ForegroundColor Red
        Write-Host "         찾은 위치: $Target"
        Write-Host ''
        Write-Host '  이 파일은 naver-blog-automation 폴더 안에서 실행해 주세요.'
        Write-Host ''
        $null = Read-Host '  Enter 를 누르면 창이 닫힙니다'
        exit 1
    }

    $Desktop = [Environment]::GetFolderPath('Desktop')
    if ([string]::IsNullOrWhiteSpace($Desktop)) {
        $Desktop = Join-Path $env:USERPROFILE 'Desktop'
    }
    $LinkPath = Join-Path $Desktop ($LinkName + '.lnk')

    $Shell    = New-Object -ComObject WScript.Shell
    $Shortcut = $Shell.CreateShortcut($LinkPath)
    $Shortcut.TargetPath       = $Target
    $Shortcut.WorkingDirectory = $Root
    $Shortcut.Description      = '네이버 블로그 주간 콘텐츠 제작 도우미를 실행합니다.'
    $Shortcut.WindowStyle      = 1

    $Icon = Join-Path $Root 'icon.ico'
    if (Test-Path -LiteralPath $Icon) {
        $Shortcut.IconLocation = "$Icon,0"
    }

    $Shortcut.Save()

    Write-Host '  만들었습니다.' -ForegroundColor Green
    Write-Host ''
    Write-Host "  바로가기 : $LinkPath"
    Write-Host "  실행 대상 : $Target"
    Write-Host ''
    Write-Host '  이제 바탕화면에서 두 번 클릭하시면 프로그램이 열립니다.'
    Write-Host ''
}
catch {
    Write-Host ''
    Write-Host '  [오류] 바로가기를 만들지 못했습니다.' -ForegroundColor Red
    Write-Host "  $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ''
    Write-Host '  회사 보안 정책이 막았을 수 있습니다.'
    Write-Host '  회사PC_문제해결.md 의 "바로가기가 안 만들어질 때" 를 봐 주세요.'
    Write-Host ''
    $null = Read-Host '  Enter 를 누르면 창이 닫힙니다'
    exit 1
}

$null = Read-Host '  Enter 를 누르면 창이 닫힙니다'
