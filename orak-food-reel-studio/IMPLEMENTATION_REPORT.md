# IMPLEMENTATION_REPORT — 설치형 앱 작업 내역

## 무엇을 했나

기존 웹 앱(Next.js)을 **그대로 두고**, 그것을 창 하나에 담아 실행하는
Electron 껍데기와 Windows 설치 파일 구성을 얹었습니다.

**기능·화면 경로·API·데이터 구조는 하나도 바꾸지 않았습니다.**

## 새로 만든 파일

| 파일 | 하는 일 |
|---|---|
| `electron/main.js` | 창을 띄우고, 안에서 Next 서버를 조용히 실행 |
| `electron/preload.js` | 화면 쪽에 열어 주는 창구 (최소한만) |
| `electron/icon.png` / `.ico` / `.svg` | 앱 아이콘 (**임시**) |
| `scripts/prepare-desktop.mjs` | 설치본에 넣을 파일 선별 + **비밀값 검사** |
| `scripts/make-icon.mjs` | 아이콘 생성 (로고 교체용) |
| `설치파일만들기.bat` | 회사 PC에서 더블클릭 → 설치 파일 생성 |
| `tests/paths.test.ts` | 경로 이전 회귀 테스트 5개 |

## 고친 파일

| 파일 | 무엇을 | 왜 |
|---|---|---|
| `src/lib/paths.ts` | `ORAK_HOME` / `ORAK_OUTPUT_DIR` 로 쓰기 폴더를 옮길 수 있게. 첫 실행 때 기본 자원 복사 | 설치본은 Program Files 에 쓸 수 없다 |
| `src/lib/ffmpeg.ts` | `ORAK_FFMPEG_PATH` / `ORAK_FFPROBE_PATH` 를 먼저 본다 | 설치본에 FFmpeg 를 함께 넣어 다운로드에 기대지 않게 |
| `next.config.ts` | `output: "standalone"` | node_modules 없이 혼자 도는 서버 |
| `package.json` | electron·electron-builder, `desktop:*` 스크립트, NSIS 설정 | 설치 파일 구성 |
| `tsconfig.json` | `dist-*` 제외 | 빌드 산출물을 타입 검사하지 않게 |
| `.gitignore` | `dist-app` `dist-bin` `dist-installer` | 용량이 크고 PC마다 다시 만들면 된다 |

**기본값은 전부 종전과 같습니다.** `ORAK_HOME` 이 없으면 `paths.ts` 는 지금까지와
똑같이 동작하므로 **`start.bat` 방식이 그대로 살아 있습니다.** (테스트로 확인)

## 구조

```
바탕화면 아이콘
  └ Electron 메인 프로세스 (electron/main.js)
      ├ 빈 포트를 찾는다
      ├ resources/app/server.js 를 fork  ← Next.js standalone
      │   ORAK_HOME       = %APPDATA%\...        (DB·설정·로그)
      │   ORAK_OUTPUT_DIR = 내 문서\오락푸드 AI릴스\완성영상
      │   ORAK_FFMPEG_PATH = resources/bin/ffmpeg.exe
      ├ 서버가 응답할 때까지 기다린다
      └ 창 하나에 그 주소를 연다
```

## 보안

| 항목 | 어떻게 |
|---|---|
| 화면에서 Node 직접 접근 | **차단** (`nodeIntegration:false`, `contextIsolation:true`, `sandbox:true`) |
| 개발자 도구 | 배포판에서 **끔** (`devTools: isDev`) |
| 바깥 주소 열기 | 앱 창이 아니라 **기본 브라우저**로 (`setWindowOpenHandler`) |
| 앱 중복 실행 | **막음** — 두 번째 실행은 기존 창을 앞으로 |
| 창 닫을 때 서버 | **함께 종료** (유령 프로세스 방지) |
| API 키 | 기존대로 **AES-256-GCM 암호화**, 사용자 폴더에만 |
| **설치본에 비밀값** | **선별 + 사후 검사**, 발견 시 빌드 중단 |

## 조사 중 발견한 결함 두 가지

**① 설치본에 API 키가 실려 나갈 뻔했습니다.**
standalone 빌드가 `.env`, `data/.secret`, `orak-studio.db` 를 그대로 복사하고 있었습니다.
→ 선별 + 검사로 막았고, 검사가 실제로 막는지 가짜 키로 시험했습니다.

**② FFmpeg 가 `optionalDependencies` 였습니다.**
다운로드가 실패해도 npm 이 **조용히 넘어갑니다.** 집 PC 에서 "FFmpeg 를 찾을 수 없습니다" 가
났던 진짜 이유입니다.
→ 설치본에는 실행 파일을 **함께 넣습니다.** 폴더 실행 방식에는 `npm run ffmpeg` 자동 복구가 있습니다.

## 하지 않은 것

프롬프트에 적힌 **영상 가져오기 · 음성 추출 · STT 대본 · 릴스 편집기(자르기·마스킹·워터마크)**
는 만들지 않았습니다. 사용자와 확인한 결과 **"지금 프로그램을 설치형으로"** 를 선택하셨습니다.

이 프로그램은 맛집 이름을 넣으면 AI 가 전부 만들어 주는 도구이고,
위 기능들은 기존 영상을 가공하는 **다른 제품**입니다. 이어붙이는 것이 아니라 새로 만드는 일입니다.

## 남은 위험

1. **코드 서명 인증서 없음** → 설치 시 Windows 경고
2. **아이콘 임시** → 최종 로고 필요
3. **설치 파일 생성은 Windows 에서만** → 회사 PC 에서 `설치파일만들기.bat`
4. **외부 API 연동은 이 작업에서 검증하지 않음** → 키가 필요하며 별개 사안
