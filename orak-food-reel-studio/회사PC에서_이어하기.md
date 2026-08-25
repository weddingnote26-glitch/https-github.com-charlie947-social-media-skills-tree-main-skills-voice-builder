# 🏢 회사 PC에서 똑같이 사용하기

> 이어서 개발할 때는 **`이어서_하기.md`** 를 먼저 보세요 — 오늘 상태와 다음 할 일이 적혀 있습니다.

이 프로젝트의 모든 결과물은 GitHub 브랜치(`claude/orak-food-reel-studio-2kux9t`)에 올라가 있습니다.
회사 PC에서는 **받아서 실행만 하면** 집과 똑같이 동작합니다.

## 방법 A — 그냥 실행만 하면 될 때 (Claude 불필요)

1. 저장소 폴더에서 `받아오기.ps1` 실행 (또는 `git pull`)
2. `orak-food-reel-studio` 폴더의 **start.bat 더블클릭**
3. 끝. (`.env` 는 PC마다 따로 있으므로, 처음 한 번 API 키만 다시 채워 주세요)

> `.env` 와 `data/`(DB), `output/`(완성 영상)은 보안·용량 때문에 GitHub에 올라가지 않습니다.
> 콘텐츠 기록까지 옮기려면 `data/orak-studio.db` 파일 하나만 USB/드라이브로 복사하면 됩니다.

## 방법 B — 회사 PC의 Claude Code에서 이어서 개발할 때

새 Claude Code 세션에 아래를 그대로 붙여넣으세요:

```
이 저장소의 claude/orak-food-reel-studio-2kux9t 브랜치를 받아와줘.
orak-food-reel-studio/ 폴더가 「오락푸드 AI 릴스 자동제작 스튜디오」 프로젝트야.

시작하기 전에:
1. git fetch origin claude/orak-food-reel-studio-2kux9t 후 해당 브랜치로 checkout
2. orak-food-reel-studio/이어서_하기.md 를 먼저 읽고 현재 상태 파악
3. npm install → npx vitest run 으로 442개 시험이 통과하는지 확인

규칙:
- 기존 파일과 폴더 구조(특히 naver-blog-automation/)는 건드리지 말 것
- API 키는 .env에만, 절대 코드나 커밋에 넣지 말 것
- 작업 후 npm run build 와 npm run test 가 통과해야 하고,
  WORKLOG.md에 오늘 한 일을 추가한 뒤 같은 브랜치로 push 할 것

이제 [여기에 오늘 할 일을 적으세요]
```

## 동기화 규칙 (기존과 동일)

- 작업 시작 전: `받아오기.ps1`
- 자리 뜨기 전: `올리기.ps1`
- 한 번에 한 PC에서만 작업
