# 🥟 오락푸드 AI 릴스 자동제작 스튜디오

`@orak_food` 인스타그램을 위한 프로그램입니다.
**맛집 이름 하나만 입력하면** — 대본 → 팩트체크 → 이미지 → AI 음성 → 자막 → 영상 → 썸네일 → 인스타 본문까지 자동으로 만들고, **월~토 주 6회 예약 발행**까지 한 화면에서 관리합니다.

전속 캐릭터 **만두탐정 오락이**가 신림·관악구의 맛집을 "사건"으로 조사하는 시리즈 콘텐츠(맛집사건 #001, #002…)를 만들 수 있습니다.

---

## 1. 프로그램 소개

| 메뉴 | 하는 일 |
|---|---|
| ✨ 오늘의 릴스 | 맛집 입력 → 버튼 하나로 전체 자동 제작 |
| 🗓 이번 주 6개 | 월~토 기획안 확인 → 전체 승인 → 순차 제작 |
| 📅 콘텐츠 캘린더 | 날짜별 현황, 끌어서 일정 변경 |
| ✅ 완성 콘텐츠 | 미리보기, 장면·자막·본문 수정, 장면별 재생성 |
| 🚀 예약/발행 | Meta 공식 Instagram API로 예약·발행·재발행 |
| 📊 성과분석 | 조회·저장 등 지표 수집 + 구조 인사이트 |
| 🥟 만두탐정 오락이 | 캐릭터 고정(Character Lock), 기준 이미지 관리 |
| ⚙️ 설정 | 발행 요일/시간, 음성, 자막, 승인 모드(SAFE/AUTO) |

> **Sample Mode**: API 키가 하나도 없어도 전체 제작 흐름(대본→영상 MP4)이 실제로 동작합니다. 먼저 눌러보면서 익히세요.

## 2. 필요한 프로그램

- **Node.js** (버전 20 이상) — 프로그램 실행용
- **FFmpeg** — 영상 제작용. **보통 자동으로 설치되므로 따로 안 받아도 됩니다.**

## 3. Node.js 설치

1. https://nodejs.org 접속
2. **LTS** 라고 쓰인 초록 버튼 클릭 → 내려받은 파일 실행 → 계속 "다음"
3. 설치 후 컴퓨터를 한 번 재시작하면 확실합니다

## 4. FFmpeg 설치 (대부분 생략 가능)

이 프로그램은 FFmpeg를 **함께 자동 설치**합니다(ffmpeg-static).
`start.bat` 실행 시 "FFmpeg 사용 가능"이 나오면 아무것도 할 필요 없습니다.

직접 설치가 필요하다는 메시지가 나올 때만:
1. https://www.gyan.dev/ffmpeg/builds/ 에서 `ffmpeg-release-essentials.zip` 다운로드
2. 압축을 풀고 `C:\ffmpeg` 로 이동
3. Windows 검색 → "환경 변수" → Path 편집 → `C:\ffmpeg\bin` 추가
4. 새 명령창에서 `ffmpeg -version` 이 나오면 성공

## 5. 설치 (npm install)

**그냥 `start.bat` 을 더블클릭하면 자동으로 진행됩니다.**
(처음 실행 시 필요한 것을 내려받느라 몇 분 걸립니다)

직접 하고 싶다면 이 폴더에서 명령창을 열고:
```
npm install
```

## 6. API 키 넣기 — 두 가지 방법

### 방법 A (권장) — 프로그램 화면에서

**⚙️ 설정** 화면의 각 카드에 키 입력칸이 있습니다. 붙여넣고 **[저장]** 하면 끝입니다.
**프로그램을 다시 켤 필요가 없고**, 키는 암호화되어 저장됩니다.
키를 바꿀 때도 새 키를 붙여넣고 저장만 하면 즉시 적용됩니다.

**⚡ 실행 모드**도 화면에서 바꿉니다 — 🧪 연습 모드(무료, 샘플) ↔ 🚀 실제 모드(진짜 AI).

### 방법 B — .env 파일 (예비용)

첫 실행 때 `.env` 파일이 자동으로 만들어집니다. **메모장으로 열어** 키를 채우세요.

```
ANTHROPIC_API_KEY=      ← Claude 키 (대본·본문 생성)
ELEVENLABS_API_KEY=     ← ElevenLabs 키 (AI 음성)
ELEVENLABS_VOICE_ID=    ← 사용할 목소리 ID
IMAGE_PROVIDER=sample   ← gemini / openai / sample 중 선택
IMAGE_API_KEY=          ← 이미지 API 키
INSTAGRAM_ACCESS_TOKEN= ← 인스타 발행용 (설정 화면에서 넣어도 됨)
INSTAGRAM_USER_ID=
PUBLIC_MEDIA_BASE_URL=  ← 영상 공개 주소 (인스타 발행에만 필요)
APP_MODE=sample         ← 키를 다 넣었으면 live 로 변경
```

> ⚠️ **.env 파일은 절대 다른 사람에게 보내거나 인터넷에 올리지 마세요.** (Git에도 자동으로 제외됩니다)

## 7. 실행 방법

### 방법 A — 설치형 앱 (바탕화면 아이콘, 권장)

`설치파일만들기.bat` 더블클릭 → 만들어진 `...Setup-x64.exe` 설치 → 바탕화면 아이콘 실행.
자세한 내용은 **`INSTALL.md`**.

### 방법 B — 폴더에서 그대로

1. **`start.bat` 더블클릭**
2. 환경 확인 → (첫 회) 빌드 → 브라우저가 자동으로 열립니다
3. 주소가 안 열리면 직접: http://localhost:3000
4. 처음이면 화면의 **첫 실행 마법사(8단계)** 를 따라가세요

### 최신 버전으로 올리기

**`업데이트.bat` 더블클릭** — `start.bat` 과 같은 폴더에 있습니다.

받아오기 → 필요한 프로그램 맞추기 → 새로 만들기 → 실행까지 한 번에 합니다.
명령창에 경로를 입력할 필요가 없습니다.

## 8. ElevenLabs 설정

1. https://elevenlabs.io 가입 → 우측 상단 프로필 → **API Keys** 에서 키 발급
2. **Voices** 메뉴에서 마음에 드는 한국어 목소리 선택 → **Voice ID 복사**
   (추천: 30~40대 톤, 밝고 신뢰감 있는 목소리)
3. `.env` 에 키와 Voice ID 입력
4. 프로그램 ⚙️ 설정 → ElevenLabs → **[연결 테스트]** 로 확인
5. 말 속도(Speed)·안정감(Stability)은 설정 화면에서 조절

## 9. 이미지 API 설정

둘 중 하나만 있으면 됩니다.

**Gemini (구글)** — https://aistudio.google.com → Get API key
→ `.env`: `IMAGE_PROVIDER=gemini`, `IMAGE_API_KEY=발급받은키`

**OpenAI** — https://platform.openai.com → API keys
→ `.env`: `IMAGE_PROVIDER=openai`, `IMAGE_API_KEY=발급받은키`

설정 → 이미지 생성 → **[연결 테스트]** 로 확인하세요.

## 10. Instagram API 설정 (예약·자동 발행용)

이 프로그램은 **Meta 공식 API**만 사용합니다. 아이디/비밀번호를 저장하거나 비공식 자동화를 쓰지 않습니다.

1. Instagram 앱 → 설정 → **프로페셔널 계정으로 전환** (크리에이터/비즈니스)
2. Facebook 페이지를 만들고 Instagram과 연결
3. https://developers.facebook.com → **앱 만들기** (Business 유형)
4. 앱에 **Instagram Graph API** 추가 → `instagram_content_publish` 권한 포함 **Access Token** 발급
5. 프로그램 ⚙️ 설정 → Instagram → 토큰과 User ID 입력(**암호화 저장**) → [연결 테스트]
6. **영상 공개 주소**: Instagram 서버가 완성 영상을 내려받을 수 있어야 합니다.
   - 가장 쉬운 방법: [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) 로 `http://localhost:3000` 을 공개 → 그 주소를 `.env` 의 `PUBLIC_MEDIA_BASE_URL` 에 입력
   - 영상은 자동으로 `공개주소/output/.../reel.mp4` 로 제공됩니다

## 11. 릴스 제작 방법

1. ✨ **오늘의 릴스** 클릭
2. 맛집명(예: `신림동 ○○식당`) 또는 URL 입력
3. 스타일 선택 — 🥟 만두탐정 오락이 / 🍚 일반 맛집
4. **[AI 자동제작 시작]** 클릭 → 진행 막대가 9단계를 보여줍니다
5. 완료되면 **미리보기**에서 영상 확인
6. 장면·자막·본문 수정 가능. 특정 장면만 **[이미지만 다시]** 재생성 가능(비용 절약)
7. 마음에 들면 **[예약 발행]** 또는 **[지금 발행]**

> 확인 안 된 가격·영업시간이 들어가면 **⚠ 팩트체크**가 발행을 막습니다. 실제 정보 확인 후 수정하세요.

## 11-1. 오락이 캐릭터 기준 이미지

**이미 만들어져 있습니다.** 🥟 캐릭터 메뉴에서 확인하세요.

| 파일 | 용도 |
|---|---|
| `front.png` / `side.png` / `back.png` | 3면도 |
| `face_happy.png` / `face_surprised.png` / `face_detective.png` | 표정 3종 |
| `character_sheet.png` | 전체 캐릭터 시트 (비율·소품·컬러·고정 요소) |

이미지 생성 시 이 파일들이 **참조로 함께 전달되어** 매 영상마다 같은 얼굴·모자·비율이 유지됩니다.
(설정 → 캐릭터 고정을 끄면 참조를 보내지 않습니다.)

**직접 수정하고 싶다면** 두 가지 방법이 있습니다.

1. 원하는 오락이 이미지를 캐릭터 화면에서 **업로드해 덮어쓰기** (가장 쉬움)
2. 디자인 원본 고치기 — `scripts/character/oraki-art.mjs` 에서 색·소품·비율을 바꾸고
   ```
   npm run character
   ```
   실행하면 7종이 같은 규칙으로 다시 만들어집니다. (SVG 원본은 `assets/character/svg/`)

## 12. 예약 발행 방법

- 기본: **월~토 주 6회, 일요일 휴무** (설정에서 요일·시간 변경)
- **[예약 발행]** 을 누르면 다음 비어 있는 요일 슬롯에 자동 배정
- 🗓 **이번 주 6개** 메뉴 → 기획안 확인 → **[전체 승인]** 하면 6개를 순서대로 제작
- 예약 시각이 되면 프로그램이 자동으로 Instagram에 올립니다
  (⚠ 발행 시각에는 프로그램이 켜져 있어야 합니다 — start.bat 창을 닫지 마세요)
- 승인 모드: **SAFE**(기본, 사람 확인 후 발행) / **AUTO**(팩트체크·품질 통과 시 자동 예약)

## 13. 오류 해결

| 증상 | 해결 |
|---|---|
| start.bat 이 바로 꺼짐 | Node.js 설치 후 재시작. 그래도 안 되면 명령창에서 `start.bat` 실행해 메시지 확인 |
| "FFmpeg를 찾을 수 없습니다" | `npm install` 다시 실행 → 안 되면 4번 항목대로 직접 설치 |
| 자막이 □□□ 로 나옴 | 한글 폰트 미설치 — 인터넷 연결 후 `start.bat` 재실행(자동 다운로드) |
| 이미지/음성 생성 실패 | 설정 → 해당 API [연결 테스트]. 실패한 장면만 자동 재시도됩니다 |
| Instagram 발행 실패 | 영상은 지워지지 않습니다. 릴스 화면의 [재발행 시도] 클릭. 토큰 만료가 흔한 원인입니다 |
| 발행이 안 올라감 | PUBLIC_MEDIA_BASE_URL 이 실제 공개 주소인지, 프로그램이 켜져 있는지 확인 |
| 고친 내용이 화면에 반영 안 됨 | **`업데이트.bat` 을 더블클릭**하세요. 받아오기와 빌드를 함께 합니다 |
| PowerShell 에서 `not a git repository` / `ENOENT package.json` | 폴더 밖에서 명령을 친 것입니다. 명령창 대신 **`업데이트.bat` 더블클릭**을 쓰세요 |
| 설치 중 `Visual Studio` / `node-gyp` 오류 | 예전 버전에서 생긴 문제입니다. `node_modules` 폴더를 통째로 지우고 `start.bat`을 다시 실행하세요. (현재 버전은 C++ 컴파일이 필요 없습니다) |
| `FFmpeg를 찾을 수 없습니다` | 설치 중 실행 파일 내려받기가 막힌 것입니다. **`업데이트.bat` 또는 `start.bat` 을 다시 실행**하면 자동으로 받아옵니다. 계속 실패하면 검은 창에서 `npm run ffmpeg` |
| FFmpeg가 계속 안 잡힘 (회사 방화벽) | https://www.gyan.dev/ffmpeg/builds/ 에서 `ffmpeg-release-essentials.zip` → 압축 해제 → `bin` 폴더를 시스템 PATH에 추가 → 프로그램 재시작 |
| 설치 중 `EPERM` / 파일 접근 오류 | 폴더가 OneDrive·구글드라이브 동기화 폴더 안에 있으면 자주 납니다. `C:\orak` 처럼 동기화 안 되는 곳으로 옮기세요 |
| 처음부터 다시 하고 싶음 | `data/orak-studio.db` 삭제(콘텐츠 기록 초기화). 영상 파일은 output/ 에 그대로 남습니다 |

### 개발자용 명령

```
npm run dev        # 개발 모드
npm run build      # 빌드
npm run test       # 자동 테스트 34개
npm run smoke      # 전체 파이프라인 E2E (샘플 모드로 실제 MP4 생성)
npm run doctor     # 환경 점검
npm run character  # 오락이 기준 이미지 7종 다시 만들기
```

### 폴더 구조

```
output/2026-08-24_맛집명/   ← 완성 콘텐츠 (영상·대본·자막·썸네일·본문)
assets/character/           ← 오락이 기준 이미지 (front.png 등)
assets/bgm/                 ← 직접 등록한 BGM (저작권 확인된 것만!)
data/orak-studio.db         ← 모든 기록 (SQLite)
logs/                       ← 실행 로그
```
