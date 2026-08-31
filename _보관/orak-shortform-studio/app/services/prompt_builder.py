"""저장된 규칙을 실제 프롬프트로 바꿉니다 (2026-08-29 지시).

「기본 제작 필수 규칙」 은 메모장이 아닙니다. 대본·이미지·게시글을 만들 때
**여기서 프롬프트에 섞여 들어갑니다.**

    담당자 입력 (주제·플랫폼·길이·타깃·지역·톤)
      + 저장된 규칙 중 **이 작업에 해당하는 것만**
      + 이번 작업에서만 쓸 임시 규칙
    → 최종 프롬프트 → 공급자
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional, Sequence

from app.core.rules import Rule, RuleScope, RulesRepository


class Platform(str, Enum):
    INSTAGRAM = "instagram"
    YOUTUBE = "youtube"


PLATFORM_LABELS = {Platform.INSTAGRAM: "인스타그램 릴스",
                   Platform.YOUTUBE: "유튜브 쇼츠"}

ALLOWED_LENGTH_SEC = (15, 30)
"""§2 가 정한 두 가지. 30초는 절대 상한입니다 (§8)."""


@dataclass
class ProductionContext:
    """이번 한 편에 대한 담당자 입력."""

    topic: str = ""
    platform: Platform = Platform.INSTAGRAM
    length_sec: int = 30
    target: str = ""
    """예: 「50~70대 동네 주민」"""

    area: str = ""
    """예: 「신림동」"""

    tone: str = ""
    """예: 「친근하고 담백하게」"""

    use_rules: bool = True
    """화면의 「이번 제작에 규칙 반영」 체크박스."""

    extra_rules: tuple[str, ...] = ()
    """이번 작업에서만 쓸 임시 규칙. 저장되지 않습니다."""

    def normalized_length(self) -> int:
        """15 도 30 도 아니면 가까운 쪽으로 붙입니다. 30 을 넘길 수는 없습니다."""
        if self.length_sec in ALLOWED_LENGTH_SEC:
            return self.length_sec
        return min(ALLOWED_LENGTH_SEC, key=lambda v: abs(v - self.length_sec))


SCOPE_HEADINGS: dict[RuleScope, str] = {
    RuleScope.RESEARCH: "[주제·사례를 찾을 때 지킬 것]",
    RuleScope.PLAN: "[기획할 때 지킬 것]",
    RuleScope.SCRIPT: "[대본을 쓸 때 지킬 것]",
    RuleScope.IMAGE: "[이미지를 만들 때 지킬 것]",
    RuleScope.CAPTION: "[게시글을 쓸 때 지킬 것]",
    RuleScope.ANALYSIS: "[성과를 볼 때 지킬 것]",
}


class PromptBuilder:
    """규칙 + 담당자 입력 → 프롬프트에 덧붙일 글.

    공급자에게 보낼 **전체** 프롬프트를 만들지는 않습니다. 공급자마다 자기
    시스템 프롬프트가 따로 있고, 그건 캐시가 걸려 있어 함부로 흔들면
    비용이 늘어납니다 (§6). 여기서는 **덧붙일 조각**만 만듭니다.
    """

    def __init__(self, repo: Optional[RulesRepository] = None) -> None:
        self._repo = repo

    # ── 규칙 모으기 ───────────────────────────────────────
    def rules_for(self, scope: RuleScope,
                  ctx: Optional[ProductionContext] = None) -> list[Rule]:
        """이 작업에 실제로 반영될 규칙만. 화면의 「규칙 미리보기」 도 이걸 씁니다."""
        if ctx is not None and not ctx.use_rules:
            return []
        if self._repo is None:
            return []
        return self._repo.for_scope(scope)

    def rules_block(self, scope: RuleScope,
                    ctx: Optional[ProductionContext] = None) -> str:
        """규칙을 항목별로 묶어 사람이 읽을 수 있게 늘어놓습니다."""
        고른것 = self.rules_for(scope, ctx)
        임시 = tuple(ctx.extra_rules) if ctx else ()
        if not 고른것 and not 임시:
            return ""

        줄: list[str] = [SCOPE_HEADINGS.get(scope, "[지킬 것]")]
        항목별: dict[str, list[str]] = {}
        for r in 고른것:
            항목별.setdefault(r.section, []).append(r.body)
        for 항목, 목록 in 항목별.items():
            줄.append(f"- {항목}")
            줄.extend(f"  · {b}" for b in 목록)
        if 임시:
            줄.append("- 이번 건에만 해당")
            줄.extend(f"  · {b}" for b in 임시 if b.strip())
        return "\n".join(줄)

    # ── 담당자 입력 ───────────────────────────────────────
    def context_block(self, ctx: ProductionContext) -> str:
        줄 = ["[이번 콘텐츠]"]
        if ctx.topic:
            줄.append(f"- 주제: {ctx.topic}")
        줄.append(f"- 올릴 곳: {PLATFORM_LABELS.get(ctx.platform, ctx.platform)}")
        줄.append(f"- 길이: {ctx.normalized_length()}초")
        if ctx.target:
            줄.append(f"- 보는 사람: {ctx.target}")
        if ctx.area:
            줄.append(f"- 지역: {ctx.area}")
        if ctx.tone:
            줄.append(f"- 말투: {ctx.tone}")
        return "\n".join(줄)

    # ── 합치기 ────────────────────────────────────────────
    def build(self, scope: RuleScope, ctx: ProductionContext,
              base: str = "") -> str:
        """공급자에게 덧붙일 최종 글.

        Args:
            base: 공급자가 이미 갖고 있는 요청문. 있으면 맨 앞에 둡니다.
        """
        조각 = [t for t in (base.strip(), self.context_block(ctx),
                            self.rules_block(scope, ctx)) if t]
        return "\n\n".join(조각)

    def preview(self, scope: RuleScope, ctx: ProductionContext) -> str:
        """화면의 「규칙 미리보기」. 실제 보낼 것과 **같은 글**을 보여줍니다.

        미리보기와 실제가 다르면 미리보기를 믿을 수 없게 됩니다.
        """
        글 = self.rules_block(scope, ctx)
        return 글 or "이 작업에 반영될 규칙이 없습니다."
