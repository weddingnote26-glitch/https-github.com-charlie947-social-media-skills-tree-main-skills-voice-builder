"""기본 제작 필수 규칙 서비스 (2026-08-29 지시).

화면은 이 클래스만 부릅니다. SQL 도 프롬프트 조립도 화면이 알 필요가 없습니다.
"""

from __future__ import annotations

from typing import Optional, Sequence

from app.core.rules import (
    ALL_SCOPES,
    DEFAULT_RULES,
    SECTIONS,
    Rule,
    RulesRepository,
    RuleScope,
    parse_scopes,
    scopes_to_text,
)
from app.services.prompt_builder import ProductionContext, PromptBuilder

AUTO_APPLY_KEY = "rules.auto_apply"
"""「제작 시 자동 반영」 스위치. `settings` 표에 둡니다 (열쇠가 아니라 안전)."""


class ProductionRulesService:
    """규칙을 넣고·고치고·지우고, 제작할 때 꺼내 쓰는 곳."""

    def __init__(self, db) -> None:
        self._db = db
        self.repo = RulesRepository(db)
        self.builder = PromptBuilder(self.repo)

    # ── 목록 ──────────────────────────────────────────────
    def all(self) -> list[Rule]:
        return self.repo.all()

    def by_section(self) -> dict[str, list[Rule]]:
        """화면에 항목별로 접어서 보여주기 위한 묶음."""
        묶음: dict[str, list[Rule]] = {}
        for r in self.repo.all():
            묶음.setdefault(r.section, []).append(r)
        return 묶음

    def sections(self) -> list[str]:
        있는것 = list(dict.fromkeys(r.section for r in self.repo.all()))
        return 있는것 or list(SECTIONS)

    # ── 넣고 고치고 지우고 ────────────────────────────────
    def add(self, section: str, body: str,
            scopes: Sequence[RuleScope] = ALL_SCOPES) -> int:
        if not body.strip():
            raise ValueError("규칙 내용을 적어주세요.")
        return self.repo.add(Rule(section=section.strip() or "기타",
                                  body=body.strip(), scopes=tuple(scopes),
                                  sort_order=len(self.repo.all())))

    def edit(self, rule_id: int, *, section: Optional[str] = None,
             body: Optional[str] = None,
             scopes: Optional[Sequence[RuleScope]] = None) -> None:
        kw = {}
        if section is not None:
            kw["section"] = section
        if body is not None:
            kw["body"] = body
        if scopes is not None:
            kw["scopes"] = scopes_to_text(scopes)
        self.repo.update(rule_id, **kw)

    def set_enabled(self, rule_id: int, on: bool) -> None:
        self.repo.set_enabled(rule_id, on)

    def remove(self, rule_id: int) -> None:
        self.repo.remove(rule_id)

    def load_defaults(self) -> int:
        """기본 템플릿 불러오기. **고쳐 둔 문장은 덮어쓰지 않습니다.**"""
        return self.repo.load_defaults(DEFAULT_RULES)

    def ensure_seeded(self) -> int:
        """처음 켰을 때 비어 있으면 기본값을 넣어 둡니다.

        비어 있을 때만 합니다. 담당자가 **일부러 다 지운 경우**에는
        다시 채워 넣지 않습니다 — 그러면 지울 수가 없어집니다.
        """
        if self.repo.all():
            return 0
        if self._db.get_setting("rules.seeded", "") == "1":
            return 0
        넣은수 = self.load_defaults()
        self._db.put_setting("rules.seeded", "1")
        return 넣은수

    # ── 제작할 때 자동 반영 ───────────────────────────────
    @property
    def auto_apply(self) -> bool:
        return self._db.get_setting(AUTO_APPLY_KEY, "1") == "1"

    @auto_apply.setter
    def auto_apply(self, on: bool) -> None:
        self._db.put_setting(AUTO_APPLY_KEY, "1" if on else "0")

    def context_for(self, ctx: ProductionContext) -> ProductionContext:
        """자동 반영 스위치가 꺼져 있으면 규칙을 빼고 넘깁니다."""
        if not self.auto_apply:
            ctx.use_rules = False
        return ctx

    def prompt_for(self, scope: RuleScope, ctx: ProductionContext,
                   base: str = "") -> str:
        return self.builder.build(scope, self.context_for(ctx), base)

    def preview(self, scope: RuleScope, ctx: ProductionContext) -> str:
        return self.builder.preview(scope, self.context_for(ctx))
