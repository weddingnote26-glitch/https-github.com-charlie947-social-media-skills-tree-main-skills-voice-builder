# ═══════════════════════════════════════════════════════════════
#  깃허브에 올리기
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

Write-Host ''
Write-Host '════════════════════════════════════════════════════════════'
Write-Host '   깃허브에 올리기'
Write-Host '════════════════════════════════════════════════════════════'
Write-Host ''

# ── 1. git 이 있는지 ───────────────────────────────────────
# ── 클라우드 동기화 폴더 안이면 경고 ─────────────────────────
#  구글 드라이브·원드라이브는 .git 폴더의 작은 파일 수천 개를
#  순서 없이 올립니다. 그러면 작업 기록이 깨집니다.
$CloudMarkers = @{
    'google drive' = '구글 드라이브'; 'googledrive' = '구글 드라이브'
    '내 드라이브'   = '구글 드라이브'; 'my drive'    = '구글 드라이브'
    'onedrive'     = '원드라이브';    'dropbox'     = '드롭박스'
    'icloud'       = '아이클라우드';   'naver mybox' = '네이버 마이박스'
}
$CloudHit = $null
foreach ($seg in ($Root -split '[\\/]')) {
    foreach ($k in $CloudMarkers.Keys) {
        if ($seg.ToLower().Contains($k)) { $CloudHit = $CloudMarkers[$k]; break }
    }
    if ($CloudHit) { break }
}
if ($CloudHit) {
    Write-Host ''
    Write-Host "  [경고] 이 폴더가 $CloudHit 안에 있습니다." -ForegroundColor Yellow
    Write-Host "        위치: $Root"
    Write-Host ''
    Write-Host '        이대로 두면 작업 기록(.git)이 깨질 수 있습니다.'
    Write-Host "        $CloudHit 는 작은 파일 수천 개를 순서 없이 올립니다."
    Write-Host '        절반만 올라간 상태에서 다른 PC가 받으면 기록이 망가집니다.'
    Write-Host ''
    Write-Host '        이 프로젝트는 깃허브로만 동기화합니다.'
    Write-Host "        폴더를 $CloudHit 밖으로 옮겨 주세요. (예: 내 문서\블로그작업)"
    Write-Host ''
    Write-Host '        문서·보고서는 클라우드에 두셔도 괜찮습니다.'
    Write-Host '        프로그램 폴더만 밖으로 옮기시면 됩니다.'
    Write-Host ''
    $go = Read-Host '  그래도 계속하시겠습니까? (계속하려면 y, 멈추려면 Enter)'
    if ($go -ne 'y') { exit 1 }
    Write-Host ''
}

$git = Get-Command git -ErrorAction SilentlyContinue
if (-not $git) {
    Write-Host '  [오류] git 이 설치되어 있지 않습니다.' -ForegroundColor Red
    Write-Host ''
    Write-Host '        아래 주소에서 받아 설치해 주세요.'
    Write-Host '        https://git-scm.com/download/win'
    Write-Host ''
    Write-Host '        설치 중 나오는 선택지는 전부 "Next" 를 누르시면 됩니다.'
    Write-Host '        설치가 끝나면 이 파일을 다시 실행해 주세요.'
    Write-Host ''
    Read-Host '  Enter 를 누르면 창이 닫힙니다'
    exit 1
}
Write-Host '  [1/4] git 확인 … 있습니다'

# ── 2. 작업 폴더가 맞는지 ──────────────────────────────────
if (-not (Test-Path -LiteralPath (Join-Path $Root '.git'))) {
    Write-Host ''
    Write-Host '  [오류] 여기는 작업 폴더가 아닙니다.' -ForegroundColor Red
    Write-Host ''
    Write-Host "        지금 위치: $Root"
    Write-Host '        압축을 푼 폴더 안에서 실행해 주세요.'
    Write-Host '        (README.md 와 naver-blog-automation 폴더가 함께 있는 곳)'
    Write-Host ''
    Read-Host '  Enter 를 누르면 창이 닫힙니다'
    exit 1
}
Write-Host '  [2/4] 작업 폴더 확인 … 맞습니다'

# ── 3. 무엇을 올릴지 ───────────────────────────────────────
Write-Host '  [3/4] 올릴 내용을 확인합니다 …'
Write-Host ''

$changed = git status --porcelain
if ($changed) {
    Write-Host '        아직 저장하지 않은 변경이 있습니다:' -ForegroundColor Yellow
    $changed | Select-Object -First 10 | ForEach-Object { Write-Host "          $_" }
    Write-Host ''
    $ans = Read-Host '        이것도 함께 올릴까요? (Y/n)'
    if ($ans -eq '' -or $ans -match '^[Yy예네ㅇ]') {
        git add -A
        $msg = Read-Host '        무슨 작업이었나요? (그냥 Enter 쳐도 됩니다)'
        if ([string]::IsNullOrWhiteSpace($msg)) {
            $msg = "작업 저장 $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
        }
        git commit -m "$msg" | Out-Null
        Write-Host '        저장했습니다.'
    }
    Write-Host ''
}

$branch = (git rev-parse --abbrev-ref HEAD).Trim()
$count  = (git rev-list --count HEAD).Trim()
Write-Host "        브랜치    : $branch"
Write-Host "        작업 기록 : $count 개"
Write-Host ''

# ── 4. 올리기 ──────────────────────────────────────────────
Write-Host '  [4/4] 깃허브에 올립니다 …'
Write-Host ''
Write-Host '        ※ 로그인 창이 뜨면 GitHub 계정으로 로그인해 주세요.' -ForegroundColor Cyan
Write-Host '          (처음 한 번만 물어봅니다)'
Write-Host ''

git push -u origin $branch

if ($LASTEXITCODE -eq 0) {
    Write-Host ''
    Write-Host '════════════════════════════════════════════════════════════'
    Write-Host '   올리기 성공!' -ForegroundColor Green
    Write-Host '════════════════════════════════════════════════════════════'
    Write-Host ''
    Write-Host '  이제 다른 PC에서 받아 이어서 작업하실 수 있습니다.'
    Write-Host ''
    Write-Host '  다른 PC에서 처음이라면 아래를 복사해서 쓰세요:'
    $url = (git remote get-url origin).Trim()
    Write-Host "    git clone $url" -ForegroundColor Cyan
    Write-Host ''
    Write-Host '  이미 받아 두셨다면 그 폴더의 "받아오기.ps1" 을 실행하세요.'
} else {
    Write-Host ''
    Write-Host '  [실패] 올리지 못했습니다.' -ForegroundColor Red
    Write-Host ''
    Write-Host '  자주 있는 원인:'
    Write-Host '    · 로그인을 취소했거나 계정이 다릅니다'
    Write-Host '      → 이 창에서 아래를 치고 다시 실행해 보세요'
    Write-Host '        git credential-manager erase' -ForegroundColor Cyan
    Write-Host '    · 인터넷이 안 되거나 회사 방화벽이 막고 있습니다'
    Write-Host '    · 다른 PC에서 먼저 올린 내용이 있습니다'
    Write-Host '      → 아래를 먼저 실행해 보세요'
    Write-Host '        git pull --no-rebase' -ForegroundColor Cyan
    Write-Host ''
    Write-Host '  위 오류 내용을 그대로 복사해 Claude 에게 보여주시면'
    Write-Host '  무엇이 문제인지 알려 드립니다.'
}

Write-Host ''
Read-Host '  Enter 를 누르면 창이 닫힙니다'
