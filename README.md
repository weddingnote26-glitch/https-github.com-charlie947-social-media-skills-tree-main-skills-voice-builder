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
집에서 작업 ──push──▶ GitHub ──pull──▶ 회사에서 이어서 작업
     ▲                                        │
     └────────────pull◀──GitHub◀──push────────┘
```

1. **자리를 뜨기 전에 반드시 push** — 푸시하지 않은 작업은 그 컴퓨터에만 남습니다.
2. **작업을 시작하기 전에 반드시 pull** — 최신 내용을 받아온 뒤 시작합니다.
3. **한 번에 한 PC에서만** 작업합니다.

```bash
git pull                      # 시작 전
git add . && git commit -m "오늘 한 작업"
git push                      # 마친 뒤
```

로그인 정보와 개인 설정은 동기화되지 않습니다. PC마다 따로 보관됩니다.

## 회사 PC에서 처음 시작할 때

```bash
git clone https://github.com/weddingnote26-glitch/https-github.com-charlie947-social-media-skills-tree-main-skills-voice-builder.git
cd https-github.com-charlie947-social-media-skills-tree-main-skills-voice-builder/naver-blog-automation
.\setup.ps1
```

브라우저만 쓸 수 있는 환경이라면 **claude.ai/code** 에서 이 저장소를 열면
Claude가 최신 상태로 받아온 뒤 시작합니다.

## 작업 일지

어디까지 했는지는 [WORKLOG.md](WORKLOG.md) 에 있습니다.
다음 자리에서 Claude에게 **"WORKLOG 읽고 이어서 해줘"** 라고 하면 바로 이어집니다.
