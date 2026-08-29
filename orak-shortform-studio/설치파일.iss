; 오락 숏폼 AI 스튜디오 — 설치파일 만들기 (Stage 11)
;
; 쓰는 법: Inno Setup 을 깔고 이 파일을 더블클릭 → [Build] → [Compile]
;          먼저 `pyinstaller 오락숏폼스튜디오.spec` 을 돌려 dist\ 를 만들어 두세요.
;
; **관리자 권한을 요구하지 않습니다.** 담당자 PC 는 회사 계정이라 관리자
; 비밀번호를 모를 수 있습니다. 내 폴더 안에 깔면 물어보지 않습니다.

#define AppName "오락 숏폼 AI 스튜디오"
#define AppVersion "1.0.0"
#define AppExe "오락숏폼스튜디오.exe"
#define AppDir "오락숏폼스튜디오"

[Setup]
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=오락
DefaultDirName={autopf}\{#AppDir}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
OutputDir=설치파일_출력
OutputBaseFilename=오락숏폼스튜디오_설치_{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern

; 관리자 권한 없이 깝니다 (§ 담당자 PC 사정)
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog

; 64비트 윈도우만 지원합니다. PySide6 가 32비트를 안 냅니다.
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

; 한국어 창으로 뜹니다
ShowLanguageDialog=no

[Languages]
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"

[Tasks]
Name: "desktopicon"; Description: "바탕화면에 아이콘 만들기"; \
  GroupDescription: "추가로 할 일:"; Flags: checkedonce

[Files]
; PyInstaller 가 만든 폴더를 통째로 넣습니다.
Source: "dist\{#AppDir}\*"; DestDir: "{app}"; \
  Flags: ignoreversion recursesubdirs createallsubdirs

; 사용 설명서를 함께 깝니다. 담당자가 언제든 열어볼 수 있게.
Source: "직원사용법.md"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist
Source: "관리자용_안내.md"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExe}"; Description: "지금 실행하기"; \
  Flags: nowait postinstall skipifsilent

; ─────────────────────────────────────────────────────────
; [UninstallDelete] 를 **일부러 비워 두었습니다.**
;
; 담당자가 만든 영상은 「내 문서\오락 숏폼 스튜디오\」 에 있습니다.
; 지우기를 눌러도 그 폴더는 건드리지 않습니다 (§0-1 4번).
; 프로그램만 지워지고 영상·기록·설정은 그대로 남습니다.
; ─────────────────────────────────────────────────────────

[Code]
function InitializeSetup(): Boolean;
begin
  Result := True;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usPostUninstall then
    MsgBox('프로그램을 지웠습니다.' + #13#10 + #13#10 +
           '만드신 영상과 설정은 그대로 있습니다:' + #13#10 +
           '내 문서 \ 오락 숏폼 스튜디오 \' + #13#10 + #13#10 +
           '그 폴더는 건드리지 않았습니다.',
           mbInformation, MB_OK);
end;
