# 작업 저장소

집 ↔ 회사 어디서든 같은 작업을 이어서 하기 위한 저장소입니다.

- **저장소**: https://github.com/weddingnote26-glitch/https-github.com-charlie947-social-media-skills-tree-main-skills-voice-builder
- **작업 브랜치**: `claude/work-environment-setup-qkurkt`

## 지금 들어 있는 것

### `naver-blog-automation/` — 네이버 블로그 주간 콘텐츠 제작 도우미

두 블로그에 매주 월~토 12편을 올리기 위한 도구입니다.

| 채널 | 블로그 | 발행 |
|---|---|---|
| 친절한 코인 설명서 | blog.naver.com/dylankim26 | 월~토 08:30 |
| 오락 5070 경제공부소 | blog.naver.com/playorak | 월~토 07:30 |

**시작하기** → [naver-blog-automation/README.md](naver-blog-automation/README.md)

### `orak-food-reel-studio/` — 오락푸드 AI 릴스 자동제작 스튜디오

`@orak_food` 인스타그램용 릴스를 **맛집 입력 → 대본 → 팩트체크 → 이미지 → AI 음성 → 자막 → 영상(MP4) → 썸네일 → 예약 발행**까지 자동 제작하는 프로그램입니다.
전속 캐릭터 **만두탐정 오락이**(맛집사건 시리즈) 포함. 월~토 주 6회 운영.

**시작하기** → `orak-food-reel-studio/` 폴더의 **start.bat 더블클릭** / 자세한 설명은 [orak-food-reel-studio/README.md](orak-food-reel-studio/README.md)


```
원고 자동 생성 → 사실 확인 → 자동 검수 → 사람 승인 → 네이버 예약 발행
```

## 동기화 규칙

```
집에서 작업 ──올리기──▶ GitHub ──받아오기──▶ 회사에서 이어서 작업
     ▲                                        │
     └──────────받아오기◀──GitHub◀──올리기────┘
```

**명령어를 몰라도 됩니다.** 이 폴더의 두 파일만 쓰시면 됩니다.

| 언제 | 무엇을 | 어떻게 |
|---|---|---|
| **작업 시작 전** | `받아오기.ps1` | 오른쪽 클릭 → PowerShell에서 실행 |
| **자리 뜨기 전** | `올리기.ps1` | 오른쪽 클릭 → PowerShell에서 실행 |

> 처음 실행할 때 *"이 시스템에서 스크립트를 실행할 수 없으므로"* 오류가 나오면,
> PowerShell 창에서 아래를 **한 번만** 입력한 뒤 다시 실행하세요.
> ```
> Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
> ```

### 꼭 지킬 것 3가지

1. **자리를 뜨기 전에 반드시 올리기** — 안 올린 작업은 그 컴퓨터에만 남습니다.
2. **작업을 시작하기 전에 반드시 받아오기** — 최신 내용을 받고 시작합니다.
3. **한 번에 한 PC에서만** 작업합니다.

### 이어지는 것 / 안 이어지는 것

| | 내용 |
|---|---|
| ✅ 이어짐 | 프로그램, 원고, 진행 상태, 글 양식 분석, 주제 사용 기록, 작업 일지 |
| 🔒 안 올림 | 네이버 로그인 정보, 개인 설정, 실행 기록 (PC마다 따로 보관) |
| ⚠️ 안 이어짐 | **Claude 와 나눈 대화** — GitHub 는 파일만 보관합니다 |

대화는 안 이어지므로, 다른 PC에서 Claude 를 열면 이렇게 말씀하세요.

```
WORKLOG 읽고 이어서 해줘
```

그러면 [WORKLOG.md](WORKLOG.md) 를 읽고 상황을 파악합니다.

## 회사 PC에서 처음 시작할 때

**→ [회사PC_처음설치.md](회사PC_처음설치.md) 를 보세요.** 한 단계씩 적어 뒀습니다.
- 릴스 스튜디오를 회사 PC에서 처음 쓰신다면 → **`회사PC_릴스스튜디오.md`**

10분이면 끝나고, 한 번만 하면 그다음부터는 클릭 두 번입니다.

짧게 요약하면 이렇습니다.

```powershell
# 1) 스크립트 실행 허용 (한 번만)
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned

# 2) 받아오기
cd ~\Documents
git clone https://github.com/weddingnote26-glitch/https-github.com-charlie947-social-media-skills-tree-main-skills-voice-builder.git 블로그작업

# 3) 그 PC에 맞춰 설치
cd 블로그작업
.\naver-blog-automation\setup.ps1
```

> git 이 없다면 [git-scm.com/download/win](https://git-scm.com/download/win) 에서 설치하세요.
> 설치 중 선택지는 전부 "Next" 를 누르시면 됩니다.
> **설치 후에는 PowerShell 창을 닫고 새로 열어야 합니다.**

회사에서 프로그램 설치가 막혀 있다면 **claude.ai/code** 에서 이 저장소를 열면
아무것도 설치하지 않고 브라우저 안에서 작업할 수 있습니다.

### 폴더를 두 개로 나눠 씁니다

| 폴더 | 무엇을 | 동기화 |
|---|---|---|
| `G:\내 드라이브\ORAK-작업\` | 문서·보고서 | 구글 드라이브 ✅ |
| `내 문서\블로그작업\` | 블로그 프로젝트 (이 저장소) | 깃허브만 ✅ |

**블로그 폴더는 클라우드 안에 두지 마세요.**
`.git` 폴더의 작은 파일 수천 개를 클라우드가 순서 없이 올려 기록이 깨집니다.

원드라이브·구글 드라이브·드롭박스·아이클라우드·네이버 마이박스 안에서는
프로그램이 **아예 실행되지 않습니다.** 경고가 아니라 멈춤입니다.
윈도우에서 "문서" 폴더가 원드라이브로 옮겨진 경우도 잡아냅니다.

자세한 이유는 [회사PC_처음설치.md](회사PC_처음설치.md) 에 있습니다.

## 작업 일지

어디까지 했는지는 [WORKLOG.md](WORKLOG.md) 에 있습니다.
다음 자리에서 Claude에게 **"WORKLOG 읽고 이어서 해줘"** 라고 하면 바로 이어집니다.
