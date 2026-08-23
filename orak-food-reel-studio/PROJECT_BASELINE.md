# PROJECT_BASELINE — 설치형 앱 작업 전 기존 상태

작성 시점: 설치형(Electron) 패키징 작업 시작 직전
기준 커밋: `45f0edb`

이 문서는 **무엇을 건드리면 안 되는지**를 못 박아 두기 위한 기록입니다.

---

## 1. 이 프로그램이 하는 일

**맛집 이름을 넣으면 릴스 한 편이 통째로 만들어집니다.**

```
맛집명/URL 입력
  → 콘텐츠 조사 → 대본 생성(Claude) → 팩트체크
  → 이미지 생성(OpenAI/Gemini) → 음성 생성(ElevenLabs)
  → 자막 → 영상 렌더(FFmpeg) → 썸네일 → 품질 점수
  → 사람이 검수 → 예약 → Instagram 발행
```

> ⚠ **영상 가져오기·STT·영상 편집기는 없습니다.** 이 프로그램은 영상을 *만드는* 도구이지
> 기존 영상을 *가공하는* 도구가 아닙니다. 이번 작업에서 그 기능을 추가하지 않습니다.

## 2. 기술 구조

| | |
|---|---|
| 프레임워크 | Next.js 16.3.2 (App Router) + React 19 + TypeScript 5 |
| 화면 | Tailwind CSS v4 |
| 데이터 | SQLite (`node-sqlite3-wasm` — C++ 컴파일 불필요) |
| 검증 | Zod v4 |
| 영상 | FFmpeg / ffprobe (`ffmpeg-static`, `ffprobe-static`) |
| 테스트 | Vitest 153개 |
| 실행 | `start.bat` → `next start` → 브라우저 |

## 3. 화면 14개 (경로를 바꾸지 말 것)

`/` 홈 · `/today` 오늘의 릴스 · `/week` 이번 주 6개 · `/calendar` 콘텐츠 캘린더 ·
`/producing` 제작중 · `/library` 완성 콘텐츠 · `/publish` 예약·발행 · `/analytics` 성과분석 ·
`/restaurants` 맛집 DB · `/benchmark` 릴스 벤치마킹 · `/character` 만두탐정 오락이 ·
`/settings` 설정 · `/wizard` 첫 실행 마법사 · `/reel/[id]` 릴스 상세

## 4. API 25개 (계약을 바꾸지 말 것)

`/api/produce`, `/api/produce/[jobId]`, `/api/jobs`, `/api/reels`(+5), `/api/week`,
`/api/settings`, `/api/settings/test`, `/api/character`, `/api/character/library`,
`/api/voices`, `/api/voices/preview`, `/api/dashboard`, `/api/calendar`, `/api/analytics`,
`/api/restaurants`, `/api/benchmark`, `/api/tips`, `/api/wizard`, `/api/health`,
`/api/media/[...path]`

## 5. 데이터 (절대 삭제 금지)

| 위치 | 내용 | Git |
|---|---|---|
| `data/orak-studio.db` | 맛집·릴스·작업·예약·설정·**암호화된 API 키** | ❌ 제외 |
| `data/.secret` | 암호화 열쇠 — **이게 사라지면 저장된 키를 못 읽습니다** | ❌ 제외 |
| `output/` | 완성된 MP4·썸네일 | ❌ 제외 |
| `assets/character/` | 오락이 기준 이미지 7종 | ✅ 포함 |
| `assets/fonts/*.ttf` | 한글 폰트 (첫 실행 시 자동 다운로드) | ❌ 제외 |
| `.env` | API 키 평문 | ❌ 제외 |

DB 테이블 15개: `restaurants` `content_ideas` `reels` `scenes` `media_assets`
`production_jobs` `schedules` `publishing_jobs` `instagram_posts` `analytics`
`settings` `api_logs` `tips` `benchmarks` `weekly_plans`

## 6. 이번 작업에서 보호할 것

1. **화면 경로·메뉴 이름·API 계약** — 하나도 바꾸지 않는다
2. **9단계 파이프라인 순서와 동작**
3. **`start.bat` 실행 방식** — 설치형이 생겨도 기존 방식이 계속 되어야 한다
4. **DB 스키마와 기존 데이터**
5. **테스트 153개** — 줄어들면 안 된다
6. **API 키 암호화 저장 방식** (`data/.secret` + AES-256-GCM)

## 7. 이번 작업에서 바꾸는 것 (영향 범위)

| 파일 | 왜 |
|---|---|
| `src/lib/paths.ts` | 설치본은 Program Files 에 못 쓴다 → `ORAK_HOME` 으로 쓰기 폴더를 옮길 수 있게. **기본값은 지금과 동일**(`process.cwd()`)이라 `start.bat` 은 그대로 동작 |
| `next.config.ts` | `output: "standalone"` — 설치본이 node_modules 없이 돌게 |
| `package.json` | electron·electron-builder 개발 의존성, 빌드 스크립트 추가 |
| `electron/` (신규) | 창을 띄우는 셸 |
| `설치파일만들기.bat` (신규) | 회사 PC에서 설치 파일을 만드는 스크립트 |

**기능 코드(파이프라인·API·화면)는 건드리지 않습니다.**

## 8. 조사 중 발견한 결함

**FFmpeg 가 `optionalDependencies` 로 선언돼 있습니다.**
`npm install` 중 다운로드가 실패해도 **npm 이 조용히 넘어갑니다.** 오류도 없습니다.
집 PC 에서 "FFmpeg를 찾을 수 없습니다" 가 났던 진짜 이유입니다.

→ 설치 파일에는 FFmpeg 실행 파일을 **함께 넣어** 다운로드에 기대지 않게 합니다.

## 9. 작업 전 상태 확인

- `git status` — 깨끗 (커밋 안 된 변경 없음)
- `npx tsc --noEmit` — 통과
- `npx vitest run` — 153개 통과
- `npm run build` — 통과
