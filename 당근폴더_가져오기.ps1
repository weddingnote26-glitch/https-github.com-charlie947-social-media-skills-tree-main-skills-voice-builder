# ═══════════════════════════════════════════════════════════════
#  당근 콘텐츠 폴더 가져오기 — 조사 먼저, 복사는 확인 후
#
#  바탕화면(또는 문서 폴더)에 있는 당근 콘텐츠 폴더를 찾아서
#    ① 무엇이 들어 있는지 먼저 보여주고
#    ② 확인을 받은 다음에만 이 작업 폴더로 복사합니다.
#
#  꼭 지키는 것
#    · 지우지 않습니다.            · 덮어쓰지 않습니다.
#    · 원본은 그대로 둡니다.        · 이름이 같으면 건너뜁니다.
#    · 비밀번호·API키·로그인쿠키는 복사하지 않습니다.
#    · 숏츠·유튜브·릴스·영상·오락이 캐릭터 원본은 건드리지 않습니다.
#
#  이 파일을 마우스 오른쪽 클릭 → "PowerShell에서 실행"
#
#  "스크립트를 실행할 수 없으므로" 오류가 나오면 PowerShell 창에 한 번만:
#    Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
# ═══════════════════════════════════════════════════════════════

try {
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
    $null = chcp 65001
} catch { }

$Root = $PSScriptRoot
Set-Location -LiteralPath $Root

$대상폴더명 = '오락_당근_컨텐츠 자동 생성 프로그램'
$받을곳     = Join-Path $Root $대상폴더명
$조사결과   = Join-Path $Root '오락_당근_폴더조사결과.txt'
$가져온목록 = Join-Path $Root '오락_당근_가져온파일목록.csv'

Write-Host ''
Write-Host '════════════════════════════════════════════════════════════'
Write-Host '   당근 콘텐츠 폴더 가져오기'
Write-Host '════════════════════════════════════════════════════════════'
Write-Host ''

# ── 0. 작업 폴더가 맞는지 ──────────────────────────────────
if (-not (Test-Path -LiteralPath (Join-Path $Root '.git'))) {
    Write-Host '  [오류] 여기는 작업 폴더가 아닙니다.' -ForegroundColor Red
    Write-Host ''
    Write-Host "        지금 위치: $Root"
    Write-Host '        README.md 와 naver-blog-automation 폴더가'
    Write-Host '        함께 있는 곳에서 실행해 주세요.'
    Write-Host ''
    Read-Host '  Enter 를 누르면 창이 닫힙니다'
    exit 1
}

# ── 1. 당근 폴더 찾기 ──────────────────────────────────────
Write-Host '  [1/5] 당근 폴더를 찾습니다 …'

$찾을곳 = @(
    [Environment]::GetFolderPath('Desktop')
    [Environment]::GetFolderPath('MyDocuments')
    $env:USERPROFILE
    'C:\작업'
    'D:\작업'
)

$후보 = @()
foreach ($곳 in $찾을곳) {
    if ([string]::IsNullOrWhiteSpace($곳)) { continue }
    if (-not (Test-Path -LiteralPath $곳)) { continue }
    Get-ChildItem -LiteralPath $곳 -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '당근' } |
        ForEach-Object { $후보 += $_ }
}
$후보 = @($후보 | Sort-Object FullName -Unique)

if ($후보.Count -eq 0) {
    Write-Host ''
    Write-Host '  [멈춤] 당근 폴더를 찾지 못했습니다.' -ForegroundColor Yellow
    Write-Host ''
    Write-Host '        아래 위치를 찾아보았습니다:'
    foreach ($곳 in $찾을곳) { if ($곳) { Write-Host "          $곳" } }
    Write-Host ''
    Write-Host '        비슷한 폴더를 마음대로 고르지 않습니다.' -ForegroundColor Cyan
    Write-Host '        폴더가 다른 곳에 있다면, 그 폴더를 파일 탐색기에서 열고'
    Write-Host '        주소창의 경로를 복사해 Claude 에게 알려주세요.'
    Write-Host ''
    Read-Host '  Enter 를 누르면 창이 닫힙니다'
    exit 1
}

# ── 2. 어느 폴더인지 고르기 ────────────────────────────────
Write-Host "        $($후보.Count) 개를 찾았습니다."
Write-Host ''

$번호 = 0
$정보 = @()
foreach ($f in $후보) {
    $번호++
    $파일 = @(Get-ChildItem -LiteralPath $f.FullName -Recurse -File -Force -ErrorAction SilentlyContinue)
    $크기 = 0
    if ($파일.Count -gt 0) { $크기 = [math]::Round((($파일 | Measure-Object Length -Sum).Sum) / 1MB, 1) }
    $최근 = ''
    if ($파일.Count -gt 0) { $최근 = ($파일 | Sort-Object LastWriteTime -Descending | Select-Object -First 1).LastWriteTime.ToString('yyyy-MM-dd') }
    $정보 += [pscustomobject]@{ 번호 = $번호; 경로 = $f.FullName; 파일수 = $파일.Count; 용량MB = $크기; 최근수정 = $최근 }
    Write-Host ("    [{0}] {1}" -f $번호, $f.FullName)
    Write-Host ("        파일 {0} 개 · {1} MB · 최근수정 {2}" -f $파일.Count, $크기, $최근)
}
Write-Host ''

$고른것 = $후보[0]
if ($후보.Count -gt 1) {
    $답 = Read-Host "  어느 폴더인가요? 번호를 입력하세요 (1~$($후보.Count))"
    $n = 0
    if ([int]::TryParse($답, [ref]$n) -and $n -ge 1 -and $n -le $후보.Count) {
        $고른것 = $후보[$n - 1]
    } else {
        Write-Host '  번호를 알아듣지 못했습니다. 아무것도 하지 않고 끝냅니다.' -ForegroundColor Yellow
        Read-Host '  Enter 를 누르면 창이 닫힙니다'
        exit 1
    }
}
$원본 = $고른것.FullName
Write-Host ''
Write-Host "        고른 폴더: $원본" -ForegroundColor Cyan
Write-Host ''

# ── 3. 무엇이 들어 있는지 조사 (아직 복사하지 않습니다) ────
Write-Host '  [2/5] 무엇이 들어 있는지 조사합니다 … (아직 복사하지 않습니다)'

# 복사하지 않을 것 — 폴더 이름 기준
$제외폴더 = '(^|[\\/])(\.git|node_modules|\.venv|venv|env|__pycache__|private|dist|build|숏츠|쇼츠|shorts|유튜브|youtube|릴스|reels|영상|video|remotion|oraki_master|oraki)([\\/]|$)'
# 복사하지 않을 것 — 파일 이름 기준 (민감정보·대용량 미디어)
$제외파일 = '(^\.env($|\.)|\.(key|pem|pfx|cookie|cookies|mp4|mov|avi|mkv|webm|mp3|wav|m4a|psd|ai|zip)$|^cookies\.json$|^storage_state\.json$|^secrets\.ya?ml$|^settings\.ya?ml$|^settings\.local\.ya?ml$)'

$모든파일 = @(Get-ChildItem -LiteralPath $원본 -Recurse -File -Force -ErrorAction SilentlyContinue)

$줄 = New-Object System.Collections.Generic.List[string]
$줄.Add('당근 콘텐츠 폴더 조사 결과')
$줄.Add('조사 일시 : ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
$줄.Add('원본 경로 : ' + $원본)
$줄.Add('전체 파일 : ' + $모든파일.Count + ' 개')
$줄.Add('')
$줄.Add('── 폴더 구조 (2단계까지) ──')
Get-ChildItem -LiteralPath $원본 -Directory -Recurse -Depth 1 -ErrorAction SilentlyContinue | ForEach-Object {
    $상대 = $_.FullName.Substring($원본.Length).TrimStart('\', '/')
    $안 = @(Get-ChildItem -LiteralPath $_.FullName -File -Force -ErrorAction SilentlyContinue).Count
    $줄.Add(('  {0}  (파일 {1} 개)' -f $상대, $안))
}
$줄.Add('')
$줄.Add('── 확장자별 파일 수 ──')
$모든파일 | Group-Object Extension | Sort-Object Count -Descending | ForEach-Object {
    $줄.Add(('  {0,-10} {1} 개' -f $(if ($_.Name) { $_.Name } else { '(없음)' }), $_.Count))
}
$줄.Add('')
$줄.Add('── 복사하지 않을 파일 (민감정보·보호대상·대용량) ──')
$제외목록 = @($모든파일 | Where-Object {
    $상대 = $_.FullName.Substring($원본.Length).TrimStart('\', '/')
    ($상대 -match $제외폴더) -or ($_.Name -match $제외파일)
})
if ($제외목록.Count -eq 0) {
    $줄.Add('  (없음)')
} else {
    $제외목록 | ForEach-Object {
        $줄.Add('  ' + $_.FullName.Substring($원본.Length).TrimStart('\', '/'))
    }
}
$줄 | Set-Content -LiteralPath $조사결과 -Encoding UTF8

Write-Host ''
Write-Host ("        전체 파일 {0} 개 중, 복사하지 않을 것 {1} 개" -f $모든파일.Count, $제외목록.Count)
Write-Host "        자세한 내용을 아래 파일에 적어 두었습니다:"
Write-Host "          $조사결과" -ForegroundColor Cyan
Write-Host ''
Write-Host '        ※ 비밀번호·API키·로그인쿠키·영상·오락이 캐릭터 원본은' -ForegroundColor Yellow
Write-Host '          목록에만 적고 내용은 읽지도, 복사하지도 않습니다.' -ForegroundColor Yellow
Write-Host ''

# ── 4. 복사할지 확인 ───────────────────────────────────────
Write-Host '  [3/5] 이 작업 폴더로 복사할까요?'
Write-Host ''
Write-Host "        받을 곳 : $받을곳"
Write-Host ''
if (Test-Path -LiteralPath $받을곳) {
    Write-Host '        ※ 이 폴더가 이미 있습니다. 같은 이름의 파일은' -ForegroundColor Yellow
    Write-Host '          덮어쓰지 않고 건너뜁니다.' -ForegroundColor Yellow
    Write-Host ''
}
$답 = Read-Host '        복사할까요? (Y/n)'
if (-not ($답 -eq '' -or $답 -match '^[Yy예네ㅇ]')) {
    Write-Host ''
    Write-Host '        복사하지 않았습니다. 조사 결과 파일만 남았습니다.'
    Write-Host ''
    Read-Host '  Enter 를 누르면 창이 닫힙니다'
    exit 0
}

# ── 5. 복사 (덮어쓰기 없음) ────────────────────────────────
Write-Host ''
Write-Host '  [4/5] 복사합니다 … (덮어쓰지 않습니다)'

if (-not (Test-Path -LiteralPath $받을곳)) {
    [void][System.IO.Directory]::CreateDirectory($받을곳)
}

$복사됨 = 0; $건너뜀 = 0; $제외됨 = 0
$기록 = New-Object System.Collections.Generic.List[object]

foreach ($f in $모든파일) {
    $상대 = $f.FullName.Substring($원본.Length).TrimStart('\', '/')

    if (($상대 -match $제외폴더) -or ($f.Name -match $제외파일)) {
        $제외됨++
        $기록.Add([pscustomobject]@{
            원래경로 = $f.FullName; 받은경로 = ''; 처리 = '복사안함(민감정보·보호대상·대용량)'
            크기 = $f.Length; 최근수정 = $f.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')
        })
        continue
    }

    $목적지 = Join-Path $받을곳 $상대
    if (Test-Path -LiteralPath $목적지) {
        $건너뜀++
        $기록.Add([pscustomobject]@{
            원래경로 = $f.FullName; 받은경로 = $목적지; 처리 = '건너뜀(이미 있음·덮어쓰지 않음)'
            크기 = $f.Length; 최근수정 = $f.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')
        })
        continue
    }

    $부모 = Split-Path -Parent $목적지
    if (-not (Test-Path -LiteralPath $부모)) { [void][System.IO.Directory]::CreateDirectory($부모) }
    # .NET 으로 복사합니다. 이름에 [ ] 가 든 한글 파일도 안전하고,
    # 마지막 false 가 "덮어쓰기 금지" 라 이중으로 막힙니다.
    try { [System.IO.File]::Copy($f.FullName, $목적지, $false) } catch { }
    if (Test-Path -LiteralPath $목적지) {
        $복사됨++
        $기록.Add([pscustomobject]@{
            원래경로 = $f.FullName; 받은경로 = $목적지; 처리 = '복사함'
            크기 = $f.Length; 최근수정 = $f.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')
        })
    }
}

$기록 | Export-Csv -LiteralPath $가져온목록 -NoTypeInformation -Encoding UTF8

Write-Host ''
Write-Host ("        복사함     : {0} 개" -f $복사됨)
Write-Host ("        건너뜀     : {0} 개  (이미 있어서 덮어쓰지 않음)" -f $건너뜀)
Write-Host ("        복사안함   : {0} 개  (민감정보·보호대상·대용량)" -f $제외됨)
Write-Host ''
Write-Host "        무엇을 어떻게 했는지 아래 파일에 적어 두었습니다:"
Write-Host "          $가져온목록" -ForegroundColor Cyan
Write-Host ''
Write-Host '        원본은 그대로 있습니다. 아무것도 지우지 않았습니다.' -ForegroundColor Green
Write-Host ''

# ── 6. 다음에 할 일 ────────────────────────────────────────
Write-Host '  [5/5] 다음에 하실 일'
Write-Host ''
Write-Host '════════════════════════════════════════════════════════════'
Write-Host '   가져오기 완료' -ForegroundColor Green
Write-Host '════════════════════════════════════════════════════════════'
Write-Host ''
Write-Host '  1) 이 폴더의 "올리기.ps1" 을 실행해 깃허브에 올려 주세요.'
Write-Host '  2) 올린 뒤 Claude 에게 "당근 폴더 올렸습니다" 라고 알려 주세요.'
Write-Host '     그때부터 6개 분야 통일·이전작업 보관·중복방지 작업을 이어서 합니다.'
Write-Host ''
Write-Host '  ※ 복사되지 않은 파일이 꼭 필요하다면 Claude 에게 알려 주세요.' -ForegroundColor Cyan
Write-Host '    (비밀번호·API키·로그인쿠키는 올리지 않는 것이 안전합니다)'
Write-Host ''
Read-Host '  Enter 를 누르면 창이 닫힙니다'
