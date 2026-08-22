# 이번 주 원고 전체 검수
# 이 파일을 오른쪽 클릭 → "PowerShell에서 실행" 하시면 됩니다.
#
# "스크립트를 실행할 수 없으므로" 오류가 나오면 PowerShell 창에서 한 번만:
#   Set-ExecutionPolicy -Scope CurrentUser RemoteSigned

$Root = $PSScriptRoot
. (Join-Path $Root '_common.ps1')

$code = Invoke-BlogScript -Root $Root -Script 'review.py' -ScriptArgs $args

Wait-BeforeClose
exit $code
