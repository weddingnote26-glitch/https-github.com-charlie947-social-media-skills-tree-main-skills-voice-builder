"""기본 제작 필수 규칙 (2026-08-29 지시).

담당자가 콘텐츠를 만들 때 **늘 지켜야 하는 기준**을 앱 안에 저장해 두고,
대본·이미지·게시글·기획을 만들 때 프롬프트에 **자동으로 섞어 넣습니다.**

단순 메모가 아닙니다. `app/services/prompt_builder.py` 가 이걸 읽어
실제로 AI 에게 보내는 문장을 만듭니다.

**저장 위치**: SQLite `rulesets` 표. 열쇠와 섞이지 않도록 표를 따로 씁니다.
본문은 `Database._clean()` 을 거치므로 토큰이 든 문장을 붙여넣어도
평문으로 남지 않습니다 (§0-3 · MVP 판정 18번).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Iterable, Optional, Sequence


class RuleScope(str, Enum):
    """이 규칙을 **어느 작업에** 반영할 것인가."""

    RESEARCH = "research"
    """주제 발굴 · 경쟁 콘텐츠 분석"""

    PLAN = "plan"
    """콘텐츠 기획 · 캘린더"""

    SCRIPT = "script"
    """대본 만들기"""

    IMAGE = "image"
    """이미지 만들기"""

    CAPTION = "caption"
    """게시글 · 캡션 · 해시태그"""

    ANALYSIS = "analysis"
    """성과 분석"""


ALL_SCOPES: tuple[RuleScope, ...] = tuple(RuleScope)

SCOPE_LABELS: dict[RuleScope, str] = {
    RuleScope.RESEARCH: "주제 찾기",
    RuleScope.PLAN: "기획",
    RuleScope.SCRIPT: "대본",
    RuleScope.IMAGE: "이미지",
    RuleScope.CAPTION: "게시글",
    RuleScope.ANALYSIS: "성과",
}


def parse_scopes(text: str) -> tuple[RuleScope, ...]:
    """`"script,image"` → `(SCRIPT, IMAGE)`.

    빈 값은 **전체 공통**으로 봅니다 — 「어디에 쓸지 안 정함」 은
    「아무 데도 안 씀」 보다 「어디에나 씀」 이 담당자 의도에 가깝습니다.
    모르는 이름은 조용히 버립니다. 저장된 글자가 낡아도 앱이 죽으면 안 됩니다.
    """
    if not text or not text.strip():
        return ALL_SCOPES
    골라낸것 = []
    for 조각 in text.split(","):
        조각 = 조각.strip().lower()
        if not 조각:
            continue
        if 조각 == "all":
            return ALL_SCOPES
        try:
            골라낸것.append(RuleScope(조각))
        except ValueError:
            continue
    return tuple(골라낸것) if 골라낸것 else ALL_SCOPES


def scopes_to_text(scopes: Iterable[RuleScope]) -> str:
    골라낸것 = list(dict.fromkeys(scopes))
    if not 골라낸것 or set(골라낸것) == set(ALL_SCOPES):
        return "all"
    return ",".join(s.value for s in 골라낸것)


@dataclass(frozen=True)
class Rule:
    """규칙 한 줄."""

    section: str
    body: str
    scopes: tuple[RuleScope, ...] = ALL_SCOPES
    enabled: bool = True
    sort_order: int = 0
    is_builtin: bool = False
    rule_id: Optional[int] = None

    def applies_to(self, scope: RuleScope) -> bool:
        return self.enabled and scope in self.scopes

    @classmethod
    def from_row(cls, row: dict) -> "Rule":
        return cls(
            section=row.get("section", ""),
            body=row.get("body", ""),
            scopes=parse_scopes(row.get("scopes", "")),
            enabled=bool(row.get("enabled", 1)),
            sort_order=int(row.get("sort_order", 0)),
            is_builtin=bool(row.get("is_builtin", 0)),
            rule_id=row.get("id"),
        )


# ─────────────────────────────────────────────────────────────
# 기본 템플릿 (지시서 「기본 제작 필수 규칙 기본 항목」 그대로)
# ─────────────────────────────────────────────────────────────
#
# 담당자가 고칠 수 있습니다. 여기 있는 것은 **처음 한 번 넣어 주는 값**입니다.
# 「기본값 불러오기」 를 누르면 이 목록에서 **없는 것만** 채워 넣습니다 —
# 담당자가 고쳐 놓은 문장을 덮어쓰지 않습니다.

_S = RuleScope

DEFAULT_RULES: tuple[Rule, ...] = (
    # 1. 주제 발굴
    Rule("주제 발굴", "최신 뉴스에서 소재를 찾는다.", (_S.RESEARCH, _S.PLAN)),
    Rule("주제 발굴", "최신 트렌드를 반영한다.", (_S.RESEARCH, _S.PLAN)),
    Rule("주제 발굴", "지역 이슈를 함께 살핀다.", (_S.RESEARCH, _S.PLAN)),
    Rule("주제 발굴", "담당자가 입력한 지역·업종·주제와 관련 있는 내용을 먼저 쓴다.",
         (_S.RESEARCH, _S.PLAN, _S.SCRIPT)),

    # 2. 경쟁 콘텐츠 분석
    Rule("경쟁 콘텐츠 분석", "인스타그램 사례를 참고한다.", (_S.RESEARCH,)),
    Rule("경쟁 콘텐츠 분석", "유튜브 사례를 참고한다.", (_S.RESEARCH,)),
    Rule("경쟁 콘텐츠 분석", "블로그 사례를 참고한다.", (_S.RESEARCH,)),
    Rule("경쟁 콘텐츠 분석", "잘된 제목·후킹 문구·구성·CTA 를 참고한다.",
         (_S.RESEARCH, _S.SCRIPT, _S.CAPTION)),
    Rule("경쟁 콘텐츠 분석", "그대로 베끼지 않는다. 참고한 뒤 새로 쓴다.",
         (_S.RESEARCH, _S.SCRIPT, _S.CAPTION, _S.IMAGE)),

    # 3. 콘텐츠 기획
    Rule("콘텐츠 기획", "주간 콘텐츠 계획을 세울 수 있다.", (_S.PLAN,)),
    Rule("콘텐츠 기획", "월간 콘텐츠 계획을 세울 수 있다.", (_S.PLAN,)),
    Rule("콘텐츠 기획", "이미 만든 주제와 겹치지 않게 한다.", (_S.PLAN, _S.RESEARCH)),
    Rule("콘텐츠 기획", "대상 연령·타깃·지역을 반영한다.",
         (_S.PLAN, _S.SCRIPT, _S.CAPTION)),

    # 4. 인스타 / 유튜브 원고
    Rule("인스타 / 유튜브 원고", "3~5장 구조로 만들 수 있다.", (_S.CAPTION, _S.IMAGE)),
    Rule("인스타 / 유튜브 원고", "제목·본문·CTA 를 모두 넣는다.", (_S.CAPTION,)),
    Rule("인스타 / 유튜브 원고", "휴대폰에서 읽기 쉽게 짧고 분명하게 쓴다.",
         (_S.CAPTION, _S.SCRIPT)),
    Rule("인스타 / 유튜브 원고", "긴 문장과 어려운 말을 줄인다.",
         (_S.CAPTION, _S.SCRIPT)),

    # 5. 릴스 / 쇼츠 대본
    Rule("릴스 / 쇼츠 대본", "15초 길이로 만들 수 있다.", (_S.SCRIPT,)),
    Rule("릴스 / 쇼츠 대본", "30초 길이로 만들 수 있다.", (_S.SCRIPT,)),
    Rule("릴스 / 쇼츠 대본", "처음 3초에 사람을 붙잡는 문구를 넣는다.", (_S.SCRIPT,)),
    Rule("릴스 / 쇼츠 대본", "장면 단위로 나눈다.", (_S.SCRIPT,)),
    Rule("릴스 / 쇼츠 대본", "장면마다 내레이션·자막·화면 설명을 함께 적는다.",
         (_S.SCRIPT, _S.IMAGE)),

    # 6. 이미지 제작
    Rule("이미지 제작", "카드뉴스로 쓸 수 있게 만든다.", (_S.IMAGE,)),
    Rule("이미지 제작", "썸네일로 쓸 수 있게 만든다.", (_S.IMAGE,)),
    Rule("이미지 제작", "캐릭터 이미지를 만들 수 있다.", (_S.IMAGE,)),
    Rule("이미지 제작", "기준 이미지가 있으면 캐릭터 생김새를 그대로 유지한다.",
         (_S.IMAGE,)),

    # 7. 게시글 제작
    Rule("게시글 제작", "인스타 캡션을 만든다.", (_S.CAPTION,)),
    Rule("게시글 제작", "게시글 본문을 만든다.", (_S.CAPTION,)),
    Rule("게시글 제작", "해시태그를 넣는다.", (_S.CAPTION,)),
    Rule("게시글 제작", "CTA 를 넣는다.", (_S.CAPTION,)),
    Rule("게시글 제작", "플랫폼마다 길이를 다르게 맞춘다.", (_S.CAPTION,)),

    # 8. 성과 분석
    Rule("성과 분석", "조회수를 본다.", (_S.ANALYSIS,)),
    Rule("성과 분석", "저장수를 본다.", (_S.ANALYSIS,)),
    Rule("성과 분석", "공유수를 본다.", (_S.ANALYSIS,)),
    Rule("성과 분석", "댓글수를 본다.", (_S.ANALYSIS,)),
    Rule("성과 분석", "담당자가 수치를 넣으면 무엇을 고치면 좋을지 제안한다.",
         (_S.ANALYSIS,)),
)

SECTIONS: tuple[str, ...] = tuple(dict.fromkeys(r.section for r in DEFAULT_RULES))


# ─────────────────────────────────────────────────────────────
# 저장소
# ─────────────────────────────────────────────────────────────


class RulesRepository:
    """`rulesets` 표를 다루는 얇은 창구.

    SQL 은 `Database` 가 갖고 있습니다. 여기서는 `Rule` 로 바꿔 주기만 합니다 —
    화면과 서비스가 dict 대신 타입을 보게 하려는 것입니다.
    """

    def __init__(self, db) -> None:
        self._db = db

    def all(self) -> list[Rule]:
        return [Rule.from_row(r) for r in self._db.rules()]

    def enabled(self) -> list[Rule]:
        return [Rule.from_row(r) for r in self._db.rules(enabled_only=True)]

    def for_scope(self, scope: RuleScope) -> list[Rule]:
        return [r for r in self.enabled() if r.applies_to(scope)]

    def add(self, rule: Rule) -> int:
        return self._db.add_rule(
            section=rule.section, body=rule.body,
            scopes=scopes_to_text(rule.scopes), enabled=rule.enabled,
            sort_order=rule.sort_order, is_builtin=rule.is_builtin)

    def update(self, rule_id: int, **kw) -> None:
        if "scopes" in kw and not isinstance(kw["scopes"], str):
            kw["scopes"] = scopes_to_text(kw["scopes"])
        self._db.update_rule(rule_id, **kw)

    def set_enabled(self, rule_id: int, on: bool) -> None:
        self._db.update_rule(rule_id, enabled=on)

    def remove(self, rule_id: int) -> None:
        self._db.remove_rule(rule_id)

    def load_defaults(self, rules: Sequence[Rule] = DEFAULT_RULES) -> int:
        """기본 템플릿을 넣습니다. **이미 있는 문장은 건드리지 않습니다.**

        담당자가 고쳐 둔 문장을 덮어쓰지 않으려는 것입니다.
        같은 (항목, 본문) 이 있으면 넘어갑니다.

        Returns:
            새로 넣은 개수.
        """
        있는것 = {(r.section, r.body) for r in self.all()}
        넣은수 = 0
        for i, r in enumerate(rules):
            if (r.section, r.body) in 있는것:
                continue
            self.add(Rule(section=r.section, body=r.body, scopes=r.scopes,
                          enabled=r.enabled, sort_order=i, is_builtin=True))
            넣은수 += 1
        return 넣은수
