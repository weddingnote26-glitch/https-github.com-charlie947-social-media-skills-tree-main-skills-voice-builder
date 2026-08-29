"""대본이 지켜야 하는 규칙 (지시서 §6 · §7 · §1-1 · §8).

**여기에는 API 호출이 없습니다.** 순수한 검사만 합니다. 그래서 두 곳이 함께 씁니다.

1. 대본을 만들 때 — 규칙을 어기면 최대 2회 다시 만듭니다 (§6)
2. 담당자가 화면에서 고쳤을 때 — 고친 결과도 같은 규칙으로 검사합니다

한 곳에만 두면 「AI 가 만든 건 검사하는데 사람이 고친 건 안 하는」 구멍이 생깁니다.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Sequence

from app.contracts.models import (
    KOREAN_CHARS_PER_SEC,
    MAX_TOTAL_SEC,
    SCENE_COUNT_MAX,
    SCENE_COUNT_MIN,
    SUBTITLE_MAX_CHARS_PER_LINE,
    SUBTITLE_MAX_LINES,
    RenderMode,
)

# §6 — 객관적 근거 없는 최상급은 부당 표시광고가 될 수 있습니다.
FORBIDDEN_WORDS = (
    "최고", "1등", "일등", "무조건", "대박", "역대급", "여기 아니면 없는",
    "여기밖에", "국내 최초", "세계 최초", "완벽", "100%",
)

AD_PREFIX = "유료광고 포함"

# 낭독 속도 상한. 초당 6자를 넘으면 시간 안에 못 읽습니다.
_CHARS_PER_SEC_MAX = KOREAN_CHARS_PER_SEC[1]


@dataclass(frozen=True)
class Problem:
    """무엇이 왜 잘못됐고 어떻게 고치면 되는지.

    ``message`` 는 **담당자에게 그대로 보여줄 한국어**입니다 (§9).
    """

    where: str
    message: str
    fix: str = ""

    def __str__(self) -> str:
        return f"{self.where} — {self.message}"


def _count_korean(text: str) -> int:
    """읽는 데 걸리는 글자 수. 공백과 문장부호는 세지 않습니다."""
    return len(re.sub(r"[\s.,!?·…~\-—\"'()\[\]]", "", text))


def check_narration_length(narration: str, seconds: float) -> Problem | None:
    """이 Scene 시간 안에 읽을 수 있는 분량인가 (§6)."""
    limit = int(seconds * _CHARS_PER_SEC_MAX)
    n = _count_korean(narration)
    if n > limit:
        return Problem(
            where="읽어줄 말",
            message=f"{seconds:g}초에 {n}자는 너무 깁니다. {limit}자까지 됩니다.",
            fix=f"{n - limit}자를 줄여주세요.",
        )
    return None


def check_screen_text(text: str) -> list[Problem]:
    """자막 규칙 — 1~2줄, 한 줄 16자 이하 (§7)."""
    problems: list[Problem] = []
    lines = [ln for ln in text.splitlines() if ln.strip()]
    if len(lines) > SUBTITLE_MAX_LINES:
        problems.append(Problem(
            where="화면 자막",
            message=f"{len(lines)}줄입니다. {SUBTITLE_MAX_LINES}줄까지 됩니다.",
            fix="줄을 합치거나 문장을 나눠주세요."))
    for i, line in enumerate(lines, 1):
        if len(line.strip()) > SUBTITLE_MAX_CHARS_PER_LINE:
            problems.append(Problem(
                where=f"화면 자막 {i}번째 줄",
                message=f"{len(line.strip())}자입니다. "
                        f"한 줄 {SUBTITLE_MAX_CHARS_PER_LINE}자까지 됩니다.",
                fix="더 짧게 끊어주세요."))
    return problems


def find_forbidden_words(text: str) -> list[str]:
    """과장 표현이 들어갔는가 (§6)."""
    return [w for w in FORBIDDEN_WORDS if w in text]


def check_scene(scene: dict[str, Any]) -> list[Problem]:
    """Scene 하나를 검사합니다."""
    problems: list[Problem] = []
    idx = scene.get("idx", "?")
    where = f"장면 {idx}"

    start = float(scene.get("start_sec", 0))
    end = float(scene.get("end_sec", 0))
    if end <= start:
        problems.append(Problem(where, "끝나는 시간이 시작보다 빠르거나 같습니다."))
        return problems

    narration = scene.get("narration", "") or ""
    if p := check_narration_length(narration, end - start):
        problems.append(Problem(f"{where} · {p.where}", p.message, p.fix))

    for p in check_screen_text(scene.get("screen_text", "") or ""):
        problems.append(Problem(f"{where} · {p.where}", p.message, p.fix))

    합친글 = f"{narration} {scene.get('screen_text', '')}"
    if found := find_forbidden_words(합친글):
        problems.append(Problem(
            where, f"쓰면 안 되는 표현이 있습니다: {', '.join(found)}",
            "근거 없는 최상급 표현은 부당 광고가 될 수 있습니다. 다른 말로 바꿔주세요."))

    mode = scene.get("render_mode", "")
    if mode not in {m.value for m in RenderMode}:
        problems.append(Problem(where, f"알 수 없는 만드는 방식입니다: {mode}"))

    return problems


def check_script(script: dict[str, Any], *, is_paid_promotion: bool,
                 max_kling_clips: int = 2) -> list[Problem]:
    """대본 전체를 검사합니다. 빈 목록이면 통과입니다.

    Args:
        is_paid_promotion: 대가·협찬을 받았는가. 참이면 게시글 설명 맨 앞에
            「유료광고 포함」이 있어야 합니다 (§5).
        max_kling_clips: 한 편에 허용되는 영상 생성 장면 수 (§1-1).
    """
    problems: list[Problem] = []
    scenes: Sequence[dict[str, Any]] = script.get("scenes") or []

    # ── 장면 수 ──
    if not (SCENE_COUNT_MIN <= len(scenes) <= SCENE_COUNT_MAX):
        problems.append(Problem(
            "전체", f"장면이 {len(scenes)}개입니다. "
                    f"{SCENE_COUNT_MIN}~{SCENE_COUNT_MAX}개여야 합니다."))
        if not scenes:
            return problems

    # ── 번호와 시간이 이어지는가 ──
    for i, s in enumerate(scenes, 1):
        if s.get("idx") != i:
            problems.append(Problem("전체", f"장면 번호가 어긋납니다: {s.get('idx')} (…{i} 이어야 함)"))
    for a, b in zip(scenes, scenes[1:]):
        if abs(float(b.get("start_sec", 0)) - float(a.get("end_sec", 0))) > 0.01:
            problems.append(Problem(
                f"장면 {a.get('idx')}~{b.get('idx')}",
                "장면 사이에 빈 시간이 있거나 겹칩니다."))

    # ── 총 길이 (§8 — 넘으면 합성을 시작하지 않습니다) ──
    total = max((float(s.get("end_sec", 0)) for s in scenes), default=0.0)
    if total > MAX_TOTAL_SEC:
        긴것 = max(scenes, key=lambda s: float(s.get("end_sec", 0)) - float(s.get("start_sec", 0)))
        problems.append(Problem(
            "전체", f"영상이 {total:g}초입니다. {MAX_TOTAL_SEC:g}초까지 됩니다.",
            f"장면 {긴것.get('idx')} 이 가장 깁니다. 여기서 "
            f"{total - MAX_TOTAL_SEC:g}초를 줄여보세요."))

    # ── 영상 생성 장면 수 (비용의 핵심) ──
    kling = [s for s in scenes if s.get("render_mode") == RenderMode.KLING.value]
    if len(kling) > max_kling_clips:
        problems.append(Problem(
            "전체", f"영상으로 만드는 장면이 {len(kling)}개입니다. "
                    f"{max_kling_clips}개까지 됩니다.",
            "비용이 거의 다 여기서 나옵니다. 실제 사진을 쓰는 장면으로 바꿔주세요."))

    # ── 장면별 ──
    for s in scenes:
        problems.extend(check_scene(s))

    # ── 글 전체의 과장 표현 ──
    for key, 이름 in (("hook", "첫 문장"), ("full_text", "전체 대본"),
                      ("title", "제목"), ("caption", "게시글 설명")):
        if found := find_forbidden_words(script.get(key, "") or ""):
            problems.append(Problem(
                이름, f"쓰면 안 되는 표현이 있습니다: {', '.join(found)}"))

    # ── 광고 표시 (§5) ──
    caption = script.get("caption", "") or ""
    if is_paid_promotion and not caption.lstrip().startswith(AD_PREFIX):
        problems.append(Problem(
            "게시글 설명", f"맨 앞에 「{AD_PREFIX}」이 없습니다.",
            "대가·협찬을 받으면 법으로 표시해야 합니다."))

    # ── 해시태그 ──
    tags = script.get("hashtags") or []
    if not 5 <= len(tags) <= 12:
        problems.append(Problem(
            "해시태그", f"{len(tags)}개입니다. 5~12개가 좋습니다."))

    return problems


def ensure_ad_prefix(caption: str, *, is_paid_promotion: bool) -> str:
    """게시글 설명 맨 앞에 「유료광고 포함」을 붙입니다 (§5).

    **담당자가 끌 수 없습니다.** 대본을 만든 뒤 무조건 이 함수를 거칩니다.
    이미 붙어 있으면 두 번 붙이지 않습니다.
    """
    if not is_paid_promotion:
        return caption
    if caption.lstrip().startswith(AD_PREFIX):
        return caption
    return f"{AD_PREFIX}\n\n{caption}"
