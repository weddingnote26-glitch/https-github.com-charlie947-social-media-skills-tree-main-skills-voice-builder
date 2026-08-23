# TEST_REPORT — 실제로 돌린 것

모두 이 작업 중에 **실제로 실행한** 명령과 그 결과입니다.

## 1. 자동 테스트

```
$ npx vitest run
Test Files  22 passed (22)
     Tests  158 passed (158)
```

작업 전 153개 → 작업 후 **158개** (신규 5개, 줄어든 것 없음)

신규: `tests/paths.test.ts` — 경로 이전 회귀 5개

| 무엇을 확인 | 왜 중요한가 |
|---|---|
| `ORAK_HOME` 이 없으면 종전과 동일한 자리 | `start.bat` 방식이 깨지면 안 된다 |
| `ORAK_HOME` 을 주면 쓰기 폴더가 전부 이동 | 설치본이 Program Files 에 쓰면 실행이 안 된다 |
| 완성 영상 폴더만 따로 지정 가능 | 내 문서 아래에 둬야 사람이 찾는다 |
| 한글·공백 든 경로 | `내 문서\오락푸드 AI릴스` |
| 빈 문자열·공백은 무시 | 잘못된 환경변수로 엉뚱한 곳에 쓰지 않게 |

## 2. 타입 검사 · 빌드

```
$ npx tsc --noEmit          → 통과 (오류 0)
$ npm run build             → 통과 (Compiled successfully)
$ node scripts/prepare-desktop.mjs
                            → 파일 1,834개 / FFmpeg 2/2 / 비밀값 검사 통과
```

## 3. 실제 앱 실행 (Electron + 가상 디스플레이)

```
$ xvfb-run -a ./node_modules/.bin/electron electron/main.js --no-sandbox
```

| 확인 항목 | 결과 |
|---|---|
| 서버 기동 | `http://127.0.0.1:40879/` |
| 창 제목 | `오락푸드 AI 릴스 스튜디오` |
| 홈 화면 | `h1 = 🏠 홈` |
| 메뉴 링크 수 | 13 |
| 창 크기 / 표시 | 1440×900 / `보임=true` |
| 브라우저·검은 창 | **없음** |

화면 캡처로도 확인했습니다 — 주소창 없는 독립 창에 앱이 정상 렌더됩니다.

## 4. 껐다 켜기 (데이터 보존)

```
1회차: PUT /api/settings {publishTime:"07:07", reelDurationSec:42}  → 저장="07:07",42
       (앱 종료)
2회차: GET /api/settings                                            → 다시읽음="07:07",42
       GET /api/health                                              → ok=true
```

**앱을 껐다 켜도 설정이 그대로 남습니다.**

## 5. 데이터 자리 확인

| 확인 | 결과 |
|---|---|
| DB 가 사용자 폴더에 생성 | `<userData>/data/orak-studio.db` ✅ |
| 로그가 사용자 폴더에 | `<userData>/logs/app.log` ✅ |
| 오락이 기준 이미지 7종 자동 복사 | `<userData>/assets/character/` ✅ |
| 프로젝트 폴더 원본 DB 무변경 | 크기·시각 그대로 ✅ |

## 6. 보안 검사 — 검사가 실제로 막는지까지 시험

| 시험 | 결과 |
|---|---|
| 정상 빌드 | `✅ 비밀값 검사 통과` · 종료 코드 **0** |
| 가짜 키(`sk-ant-…`)가 든 파일을 일부러 넣음 | `❌ 비밀값이 설치본에 들어갔습니다. 중단합니다.` · 종료 코드 **1** |

즉 통과 문구가 장식이 아니라 **실제로 빌드를 멈춥니다.**

## 7. 기존 기능 보호 확인

```
$ npx tsx -e "import {ROOT,DIRS} from './src/lib/paths'"
ORAK_HOME 없을 때 ROOT = 프로젝트 폴더 (기존과 동일) ✅
output = 기존과 동일 ✅
```

화면 경로 14개, API 25개, 파이프라인 9단계 — **코드 변경 없음.**

## 8. 돌리지 못한 것

| 항목 | 왜 |
|---|---|
| Windows 설치 파일 생성 | 작업 환경이 리눅스, wine·NSIS 없음 |
| 설치 → 바탕화면 → 실행 → 재부팅 | 회사 PC 는 다른 컴퓨터 |
| Windows 배율 100/125/150% | 재현 불가 |
| 설치본에서 MP4 렌더 + ffprobe | 설치 후 확인 필요 |
| 외부 API 실연동 (Claude/ElevenLabs/이미지) | 유효한 키·크레딧 필요 — `KNOWN_ISSUES.md` 참고 |

**성공으로 바꿔 적은 항목은 없습니다.**
