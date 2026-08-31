"""주제 발굴 · 경쟁 콘텐츠 분석 · 성과 분석 (2026-08-29 지시).

⚠️ **여기에 자동 수집(스크래핑) 코드는 없습니다** (§0-4 · MVP 판정 19번).

지시서가 「인스타그램 사례 분석 · 유튜브 사례 분석」 을 말하지만, 같은 지시서의
§0-4 가 「웹 자동 수집 코드를 만들지 마세요 · 참고 URL은 저장만 하세요 ·
headless 브라우저 자동화 전부 금지」 라고 못 박았습니다. 당근에서 이미 같은
문제를 겪었습니다.

그래서 이번 단계는 **구조 · 저장 · 화면 연결**까지만 합니다 — 지시서도
「이번 단계에서는 실제 대규모 수집/크롤링보다 먼저 구조 / 데이터 저장 / UI /
서비스 연결을 우선한다」 고 했습니다.

담당자가 브라우저에서 직접 보고 **주소와 메모를 적어 넣습니다.** 나중에 공식
API(예: YouTube Data API) 를 붙일 자리는 `fetch_hook` 으로 비워 두었습니다.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Callable, Optional, Sequence

PLATFORMS = ("instagram", "youtube", "blog")
PLATFORM_LABELS = {"instagram": "인스타그램", "youtube": "유튜브", "blog": "블로그"}

SOURCES = ("뉴스", "트렌드", "지역이슈", "담당자")


@dataclass(frozen=True)
class TopicIdea:
    title: str
    source: str = "담당자"
    memo: str = ""
    used: bool = False
    idea_id: Optional[int] = None

    @classmethod
    def from_row(cls, row: dict) -> "TopicIdea":
        return cls(title=row.get("title", ""), source=row.get("source", ""),
                   memo=row.get("memo", ""), used=bool(row.get("used", 0)),
                   idea_id=row.get("id"))


@dataclass(frozen=True)
class CompetitorNote:
    platform: str
    url: str = ""
    note: str = ""
    note_id: Optional[int] = None

    @property
    def platform_label(self) -> str:
        return PLATFORM_LABELS.get(self.platform, self.platform)

    @classmethod
    def from_row(cls, row: dict) -> "CompetitorNote":
        return cls(platform=row.get("platform", ""), url=row.get("url", ""),
                   note=row.get("note", ""), note_id=row.get("id"))


class TopicDiscoveryService:
    """주제 아이디어를 모읍니다.

    `fetch_hook` 을 주면 그걸로 후보를 받아옵니다. **기본값은 없습니다** —
    아무것도 주지 않으면 담당자가 손으로 넣은 것만 다룹니다.
    나중에 공식 API 를 붙일 때 이 자리에 끼웁니다.
    """

    def __init__(self, db, fetch_hook: Optional[Callable[[str], Sequence[str]]] = None
                 ) -> None:
        self._db = db
        self._fetch = fetch_hook

    def add(self, title: str, *, source: str = "담당자", memo: str = "",
            project_id: Optional[int] = None) -> int:
        if not title.strip():
            raise ValueError("주제를 적어주세요.")
        return self._db.add_topic_idea(title=title.strip(), source=source,
                                       memo=memo, project_id=project_id)

    def list(self, project_id: Optional[int] = None) -> list[TopicIdea]:
        return [TopicIdea.from_row(r) for r in self._db.topic_ideas(project_id)]

    def mark_used(self, idea_id: int, used: bool = True) -> None:
        self._db.mark_topic_used(idea_id, used)

    def suggest(self, keyword: str) -> list[str]:
        """후보를 받아옵니다. **붙여 둔 것이 없으면 빈 목록입니다.**

        여기서 웹을 뒤지지 않습니다. 붙일 수 있는 것은 공식 API 뿐입니다 (§0-4).
        """
        if self._fetch is None:
            return []
        return list(self._fetch(keyword))


class CompetitorAnalysisService:
    """참고한 사례를 적어 둡니다. **주소를 열지 않습니다** (§0-4)."""

    def __init__(self, db) -> None:
        self._db = db

    def add(self, platform: str, *, url: str = "", note: str = "",
            project_id: Optional[int] = None) -> int:
        if platform not in PLATFORMS:
            raise ValueError(f"모르는 곳입니다: {platform}")
        if not (url.strip() or note.strip()):
            raise ValueError("주소나 메모 중 하나는 적어주세요.")
        return self._db.add_competitor_note(
            platform=platform, url=url.strip(), note=note.strip(),
            project_id=project_id)

    def list(self, project_id: Optional[int] = None) -> list[CompetitorNote]:
        return [CompetitorNote.from_row(r)
                for r in self._db.competitor_notes(project_id)]

    def summary_for_prompt(self, project_id: Optional[int] = None,
                           limit: int = 8) -> str:
        """대본을 만들 때 넘길 「참고한 사례」 글.

        **주소는 넣지 않습니다.** 담당자가 적은 메모만 넘깁니다 — 주소를
        넘기면 AI 가 그걸 열어보려 할 수 있고, 그건 §0-4 위반입니다.
        """
        메모들 = [n for n in self.list(project_id) if n.note.strip()][:limit]
        if not 메모들:
            return ""
        줄 = ["[담당자가 참고한 사례]"]
        줄 += [f"- ({n.platform_label}) {n.note}" for n in 메모들]
        return "\n".join(줄)


class PerformanceAnalysisService:
    """성과 수치를 넣고 무엇을 고칠지 봅니다. **담당자가 손으로 넣습니다** (§0-4)."""

    def __init__(self, db) -> None:
        self._db = db

    def add(self, *, project_id: int, views: int = 0, saves: int = 0,
            shares: int = 0, comments: int = 0, note: str = "",
            measured_on: Optional[str] = None) -> int:
        return self._db.add_metrics(
            project_id=project_id,
            measured_on=measured_on or date.today().isoformat(),
            views=views, saves=saves, shares=shares, comments=comments, note=note)

    def list(self, project_id: int) -> list[dict]:
        return self._db.metrics(project_id)

    def hints(self, project_id: int) -> list[str]:
        """수치를 보고 고칠 거리를 말해 줍니다.

        어림짐작이 아니라 **비율**로 봅니다. 조회수만 보면 알 수 없습니다 —
        저장·공유가 적으면 내용이 약한 것이고, 조회수가 적으면 첫 3초가 약한 것입니다.
        """
        기록 = self.list(project_id)
        if not 기록:
            return ["아직 넣은 수치가 없습니다."]
        m = 기록[0]
        조회 = max(int(m["views"]), 0)
        말: list[str] = []
        if 조회 < 500:
            말.append("조회수가 낮습니다. 첫 3초 후킹 문구를 바꿔 보세요.")
        if 조회 and int(m["saves"]) / 조회 < 0.01:
            말.append("저장이 적습니다. 「다시 보고 싶은 정보」(가격·위치·시간)를 넣어 보세요.")
        if 조회 and int(m["shares"]) / 조회 < 0.005:
            말.append("공유가 적습니다. 「누구랑 같이 가면 좋다」 같은 말을 넣어 보세요.")
        if 조회 and int(m["comments"]) / 조회 < 0.002:
            말.append("댓글이 적습니다. 끝에 질문을 하나 던져 보세요.")
        return 말 or ["수치가 고르게 나왔습니다. 이 구성을 유지해 보세요."]
