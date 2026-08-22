# Voice Builder — 작업 동기화 저장소

집 ↔ 회사 어디서든 같은 작업을 이어서 하기 위한 저장소입니다.
모든 작업물은 이 GitHub 저장소를 거쳐 동기화합니다.

- **저장소 주소**: https://github.com/weddingnote26-glitch/https-github.com-charlie947-social-media-skills-tree-main-skills-voice-builder
- **기본 브랜치**: `claude/work-environment-setup-qkurkt`

## 동기화 흐름

```
집에서 작업 ──push──▶ GitHub ──pull──▶ 회사에서 이어서 작업
     ▲                                        │
     └────────────pull◀──GitHub◀──push────────┘
```

지킬 규칙은 딱 2가지입니다.

1. **자리를 뜨기 전에 반드시 push** — 푸시하지 않은 작업은 그 컴퓨터에만 남습니다.
2. **작업을 시작하기 전에 반드시 pull** — 최신 내용을 받아온 뒤 시작합니다.

## 처음 한 번만: 작업물 올리기 (집 컴퓨터)

터미널(PowerShell 또는 Git Bash)에서:

```bash
# 1) 이 저장소를 원하는 위치에 내려받기
git clone https://github.com/weddingnote26-glitch/https-github.com-charlie947-social-media-skills-tree-main-skills-voice-builder.git voice-builder

# 2) 지금까지 작업한 파일들을 voice-builder 폴더 안으로 복사

# 3) 올리기
cd voice-builder
git add .
git commit -m "집 작업분 업로드"
git push
```

Claude Code를 쓰고 있다면 작업 폴더에서 이렇게 말해도 됩니다.

> 이 폴더의 작업물을 https://github.com/weddingnote26-glitch/https-github.com-charlie947-social-media-skills-tree-main-skills-voice-builder 저장소에 올려줘.

## 처음 한 번만: 회사 컴퓨터 세팅

```bash
git clone https://github.com/weddingnote26-glitch/https-github.com-charlie947-social-media-skills-tree-main-skills-voice-builder.git voice-builder
cd voice-builder
```

회사에서 git 설치가 어렵거나 브라우저만 쓸 수 있다면 **claude.ai/code** 에서
이 저장소를 선택해 클라우드 세션을 열면 됩니다. Claude가 알아서 최신 내용을
받아온 상태로 시작합니다.

## 매일 반복하는 루틴

```bash
# 작업 시작 전 (집이든 회사든)
git pull

# 작업 마치면
git add .
git commit -m "오늘 한 작업 요약"
git push
```

## 작업 일지

어디까지 했는지 기록은 [WORKLOG.md](WORKLOG.md)에 남깁니다.
다음 자리에서 Claude에게 "WORKLOG 읽고 이어서 해줘"라고 하면 바로 이어집니다.
