# 오락 숏폼 AI 스튜디오 (B)

**오락 인스타그램 콘텐츠 생성 프로그램** — 세로 영상 MP4 (Reels·Shorts)를 만든다.
Python + PySide6, Windows 배포 EXE. 신규 개발 (Stage 1).

> ⚠️ **작업 전 반드시 [`분리규칙.md`](분리규칙.md) 를 먼저 읽으세요.**
> 이 프로그램은 A(당근 카드뉴스)와 코드·폴더·설정·API 키를 일절 공유하지 않습니다.

## 세션 시작 선언 (매번)

```
저는 B(오락 숏폼) 세션입니다.
쓰기: 내 문서\블로그작업\orak-shortform-studio\ 만.
읽기: 저장소 안 assets\master\ 만.
A 폴더와 Desktop\ 전체는 건드리지 않습니다. 삭제 코드 없습니다.
```

## 폴더 계약

| 자리 | 역할 | 누가 쓰나 |
|---|---|---|
| `orak-shortform-studio\` (이 폴더) | 개발 | 개발자(Claude Code)만 |
| `orak-shortform-studio\assets\master\` | 마스터 이미지 3장 — EXE에 동봉 | **읽기 전용** (넣는 것은 사장님) |
| `내 문서\ORAK_SHORTFORM_STUDIO\` | 운영 데이터 (결과 MP4 등) | 배포 프로그램만 |
| `orak-shortform-studio\_시험출력\` | 개발 중 시험 출력 (git 제외) | 개발자만 |
| `Desktop\오락이 마스터 파일\` | 사장님 보관용 원본 | **개발자도 프로그램도 접근 금지** |

## 예정 구조 (지시서에 따름)

```
orak-shortform-studio\
├ assets\
│   ├ master\                  마스터 이미지 3장 (저장소 비공개 전환 후 추가)
│   ├ subtitle_style.json      자막 디자인 값   ← 지시서 §6·§7
│   ├ character_profile.json   캐릭터 설정
│   └ pricing.json             요금표
├ providers\
│   └ video_kenburns.py        FFmpeg 렌더 엔진
├ config.json                  API 키 4종 (Claude·Kling·Gemini·ElevenLabs) — git 제외
├ config.example.json          키 없는 견본
└ venv\                        B 전용 파이썬 환경 — git 제외
```

- 월 예산 50,000원. 요금 집계는 `assets\pricing.json` 기준.
- API 키는 `config.json` 에만 두고 절대 커밋하지 않는다 (A의 키와 별개 키).
- FFmpeg·폰트는 이 프로그램에 **별도 동봉** (A와 공유 금지).

## 현재 상태

- [x] 폴더 생성 · 분리규칙 v2(2026-08-28) 저장
- [ ] **저장소 비공개(Private) 전환** — 마스터 이미지를 넣기 전 필수 (사장님이 GitHub Settings에서)
- [ ] `assets\master\` 에 마스터 3장 추가
- [ ] Stage 1 지시서 수령 → 개발 시작
