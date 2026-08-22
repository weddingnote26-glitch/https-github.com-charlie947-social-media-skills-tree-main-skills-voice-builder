# 작업 저장소

집 ↔ 회사 어디서든 같은 작업을 이어서 하기 위한 저장소입니다.

- **저장소**: https://github.com/weddingnote26-glitch/https-github.com-charlie947-social-media-skills-tree-main-skills-voice-builder
- **작업 브랜치**: `claude/work-environment-setup-qkurkt`

## 지금 들어 있는 것

### `naver-blog-automation/` — 네이버 블로그 주간 콘텐츠 제작 도우미

두 블로그에 매주 월~토 12편을 올리기 위한 도구입니다.

| 채널 | 블로그 | 발행 |
|---|---|---|
| 친절한 코인 설명서 | blog.naver.com/dylankim26 | 월~토 07:00 |
| 오락 5070 경제공부소 | blog.naver.com/playorak | 월~토 07:30 |

**시작하기** → [naver-blog-automation/README.md](naver-blog-automation/README.md)

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

### 1. 이 저장소를 받습니다

```bash
git clone https://github.com/weddingnote26-glitch/https-github.com-charlie947-social-media-skills-tree-main-skills-voice-builder.git
```

> git 이 없다면 [git-scm.com/download/win](https://git-scm.com/download/win) 에서 설치하세요.
> 설치 중 선택지는 전부 "Next" 를 누르시면 됩니다.

### 2. 그 PC에 맞춰 한 번 설치합니다

받은 폴더 안의 `naver-blog-automation\setup.ps1` 을 실행합니다.
파이썬 환경과 개인 설정을 그 PC에 만드는 작업이며, 1~2분이면 끝납니다.
**PC마다 한 번씩만** 하면 됩니다.

### 3. 그다음부터

- 작업 시작 전 → `받아오기.ps1`
- 작업할 때 → `naver-blog-automation\run.ps1`
- 자리 뜨기 전 → `올리기.ps1`

브라우저만 쓸 수 있는 환경이라면 **claude.ai/code** 에서 이 저장소를 열면
Claude 가 최신 상태로 받아온 뒤 시작합니다.

## 작업 일지

어디까지 했는지는 [WORKLOG.md](WORKLOG.md) 에 있습니다.
다음 자리에서 Claude에게 **"WORKLOG 읽고 이어서 해줘"** 라고 하면 바로 이어집니다.
