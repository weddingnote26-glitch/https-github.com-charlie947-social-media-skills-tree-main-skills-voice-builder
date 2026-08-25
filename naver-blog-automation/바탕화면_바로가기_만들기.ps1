# ═══════════════════════════════════════════════════════════════
#  바탕화면 바로가기 만들기
#
#  이 파일에서 오른쪽 클릭 → "PowerShell에서 실행" 하시면
#  바탕화면과 시작 메뉴에 "네이버 블로그 도우미" 가 생깁니다.
#
#  바로가기는 검은 창이 뜨지 않는 **실행파일(.exe)** 을 직접 가리킵니다.
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

$AppName = '네이버 블로그 도우미'
$Exe = Join-Path $Root 'dist\네이버블로그도우미\네이버블로그도우미.exe'

Write-Host ''
Write-Host '════════════════════════════════════════════════════════════'
Write-Host '   바탕화면 바로가기 만들기'
Write-Host '════════════════════════════════════════════════════════════'
Write-Host ''

try {
    if (-not (Test-Path -LiteralPath $Exe)) {
        Write-Host '  [오류] 실행파일을 찾지 못했습니다.' -ForegroundColor Red
        Write-Host "         찾은 위치: $Exe"
        Write-Host ''
        Write-Host '  먼저 프로그램을 만들어야 합니다. 아래를 한 번 실행해 주세요.'
        Write-Host '    .\프로그램_다시만들기.ps1'
        Write-Host ''
        $null = Read-Host '  Enter 를 누르면 창이 닫힙니다'
        exit 1
    }

    $Shell = New-Object -ComObject WScript.Shell
    $made = @()

    foreach ($base in @([Environment]::GetFolderPath('Desktop'),
                        (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'))) {
        if ([string]::IsNullOrWhiteSpace($base)) { continue }
        if (-not (Test-Path -LiteralPath $base)) { continue }

        $link = Join-Path $base ($AppName + '.lnk')
        $sc = $Shell.CreateShortcut($link)
        $sc.TargetPath       = $Exe
        $sc.WorkingDirectory = Split-Path -Parent $Exe
        $sc.Description      = '네이버 블로그 글을 만들고 예약 발행을 준비합니다.'
        $sc.WindowStyle      = 1
        $icon = Join-Path $Root 'icon.ico'
        if (Test-Path -LiteralPath $icon) { $sc.IconLocation = "$icon,0" }
        $sc.Save()
        $made += $link
    }

    Write-Host '  만들었습니다.' -ForegroundColor Green
    Write-Host ''
    foreach ($m in $made) { Write-Host "   $m" }
    Write-Host ''
    Write-Host "  실행 대상 : $Exe"
    Write-Host ''
    Write-Host '  이제 바탕화면에서 두 번 클릭하시면 프로그램 창이 바로 열립니다.'
    Write-Host '  검은 명령 창은 더 이상 나타나지 않습니다.'
    Write-Host ''
}
catch {
    Write-Host ''
    Write-Host '  [오류] 바로가기를 만들지 못했습니다.' -ForegroundColor Red
    Write-Host "  $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ''
    Write-Host '  회사 보안 정책이 막았을 수 있습니다.'
    Write-Host '  그럴 때는 아래 파일에서 오른쪽 클릭 → "바로 가기 만들기" 를 하신 뒤'
    Write-Host '  만들어진 것을 바탕화면으로 끌어다 놓으셔도 됩니다.'
    Write-Host "    $Exe"
    Write-Host ''
    $null = Read-Host '  Enter 를 누르면 창이 닫힙니다'
    exit 1
}

$null = Read-Host '  Enter 를 누르면 창이 닫힙니다'
