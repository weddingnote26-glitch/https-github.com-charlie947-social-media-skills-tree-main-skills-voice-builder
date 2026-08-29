"""대본의 **모양**과 **규칙** — 공급자와 무관한 부분.

지시서 §6 이 정한 것들입니다. 어느 회사 AI 를 쓰든 대본이 갖춰야 할 모양은
같습니다. 그래서 여기 한 군데에만 둡니다 — OpenAI 와 Claude 가 이걸 같이 씁니다.

**여기를 고치면 두 공급자가 함께 바뀝니다.** 한쪽만 낡는 일이 없게 하려는 것입니다.
"""

from __future__ import annotations

from typing import Any

from app.contracts.models import (
    KOREAN_CHARS_PER_SEC,
    MAX_TOTAL_SEC,
    SCENE_COUNT_DEFAULT,
    SCENE_COUNT_MAX,
    SCENE_COUNT_MIN,
    SUBTITLE_MAX_CHARS_PER_LINE,
    RenderMode,
    Scene,
    Script,
    StoreInfo,
)
from app.core.script_rules import Problem


SCENE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "idx": {"type": "integer", "description": "1부터 시작하는 장면 번호"},
        "start_sec": {"type": "number"},
        "end_sec": {"type": "number"},
        "render_mode": {
            "type": "string",
            "enum": [RenderMode.KLING.value, RenderMode.KENBURNS.value,
                     RenderMode.STILL.value],
            "description": "오락이가 나오면 kling, 실제 음식·매장 사진이면 kenburns",
        },
        "narration": {"type": "string", "description": "읽어줄 말 (한국어)"},
        "screen_text": {"type": "string", "description": "화면 자막. 한 줄 16자 이하, 최대 2줄"},
        "image_prompt": {"type": "string", "description": "장면 이미지를 만들 영어 지시문"},
        "video_prompt": {"type": "string", "description": "움직임을 설명하는 영어 지시문. kling 장면만"},
    },
    "required": ["idx", "start_sec", "end_sec", "render_mode", "narration",
                 "screen_text", "image_prompt", "video_prompt"],
    "additionalProperties": False,
}

SCRIPT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "hook": {"type": "string", "description": "첫 3초를 붙잡는 한 문장"},
        "full_text": {"type": "string", "description": "전체 대본을 이어 쓴 것"},
        "scenes": {"type": "array", "items": SCENE_SCHEMA,
                   "minItems": SCENE_COUNT_MIN, "maxItems": SCENE_COUNT_MAX},
        "title": {"type": "string"},
        "caption": {"type": "string", "description": "인스타그램 게시글 설명"},
        "hashtags": {"type": "array", "items": {"type": "string"},
                     "minItems": 5, "maxItems": 12},
    },
    "required": ["hook", "full_text", "scenes", "title", "caption", "hashtags"],
    "additionalProperties": False,
}


# ─────────────────────────────────────────────────────────────
# 프롬프트
# ─────────────────────────────────────────────────────────────

def build_system_prompt(*, max_kling_clips: int = 2) -> str:
    """맛집마다 바뀌지 않는 부분. **캐시가 걸리는 곳입니다.**

    가게 정보처럼 매번 바뀌는 것을 여기 섞으면 캐시가 깨져 비용이 올라갑니다.
    """
    return f"""당신은 「동네친구 오락 — 만두탐정 오락이」 인스타그램 릴스의 대본을 씁니다.
관악구(신림·봉천·서울대입구) 맛집을 소개하는 세로 영상이며, 주 시청자는 50~70대입니다.

## 만들 것
장면 {SCENE_COUNT_MIN}~{SCENE_COUNT_MAX}개(기본 {SCENE_COUNT_DEFAULT}개)로 이루어진 대본 한 편.

## 반드시 지킬 것

길이
- 전체 {MAX_TOTAL_SEC:g}초를 넘기지 마세요. 넘으면 영상을 만들 수 없습니다.
- 장면 시간은 빈틈없이 이어져야 합니다. 앞 장면의 end_sec 이 다음 장면의 start_sec 입니다.
- 읽어줄 말은 그 장면 시간 안에 읽을 수 있어야 합니다.
  한국어는 초당 약 {KOREAN_CHARS_PER_SEC[0]:g}~{KOREAN_CHARS_PER_SEC[1]:g}자입니다.
  3초 장면이면 공백 빼고 18자를 넘기지 마세요.

자막 (화면에 뜨는 글)
- 한 줄 {SUBTITLE_MAX_CHARS_PER_LINE}자 이하, 최대 2줄.
- 짧은 문장으로. 접속사로 길게 잇지 마세요.
- 50~70대가 읽습니다. 어려운 말과 영어를 쓰지 마세요.

장면을 만드는 방식 (render_mode)
- 오락이(만두탐정 캐릭터)가 나오는 장면 → "kling"
- 실제 음식·매장 사진을 쓰는 장면 → "kenburns"
- **kling 장면은 최대 {max_kling_clips}개입니다.** 비용의 대부분이 여기서 나옵니다.
- kling 장면은 처음(사건 제시)과 중간(직접 먹어보고 반응)에 두는 것이 좋습니다.
- 화면 비중은 오락이 40% / 음식·매장 60% 정도로 잡으세요.

쓰면 안 되는 표현
- 최고, 1등, 무조건, 대박, 역대급, 여기 아니면 없는, 완벽, 100%
- 근거 없는 최상급은 부당 표시광고가 될 수 있습니다.
- 확인되지 않은 정보를 지어내지 마세요. 주어진 정보만 쓰세요.

말투
- 동네 친구가 알려주는 말투. 가르치려 들지 마세요.
- 불안을 부추기지 마세요. 이모지를 쓰지 마세요.

## image_prompt 와 video_prompt (영어로 쓰세요)
- image_prompt: 그 장면의 그림을 설명합니다. 오락이 장면이면 표정·동작·배경만 쓰고,
  **캐릭터 생김새는 쓰지 마세요.** 생김새는 프로그램이 따로 붙입니다.
- video_prompt: 어떻게 움직이는지만 짧게. kenburns 장면은 빈 문자열로 두세요.
- 배경에 실제 상호명·간판 글씨·실존 인물·브랜드 로고가 들어가지 않게 하세요."""


def build_user_prompt(store: StoreInfo, scene_count: int,
                      extra: str = "") -> str:
    """맛집마다 바뀌는 부분. **캐시 뒤에 옵니다.**

    Args:
        extra: 「기본 제작 필수 규칙」 이 조립해 준 글.
            `app/services/prompt_builder.py` 가 만듭니다. 매번 바뀔 수 있어서
            **캐시가 걸린 시스템 프롬프트가 아니라 여기에** 붙입니다.
    """
    lines = [
        f"장면 {scene_count}개로 만들어 주세요.",
        "",
        "## 맛집 정보",
        f"- 매장명: {store.store_name}",
        f"- 지역: {store.area}",
        f"- 주소: {store.address}",
        f"- 대표메뉴: {store.menu}",
        f"- 가격: {store.price}",
        f"- 특징: {store.features}",
        f"- 추천 이유: {store.reason}",
    ]
    if store.memo:
        lines.append(f"- 메모: {store.memo}")
    if store.photo_paths:
        lines.append(f"- 담당자가 준비한 실제 사진: {len(store.photo_paths)}장 "
                     "(이 장수만큼은 kenburns 장면으로 쓸 수 있습니다)")
    if store.disclosure.is_paid:
        lines += [
            "",
            "## 광고 표시",
            "이 매장에서 대가나 협찬을 받았습니다.",
            "게시글 설명(caption) 맨 앞 줄에 「유료광고 포함」을 넣어주세요.",
        ]
    if extra.strip():
        lines += ["", extra.strip()]
    lines += [
        "",
        "위 정보에 없는 것은 지어내지 마세요.",
        "특히 영업시간·휴무일·주차 여부는 알 수 없으므로 쓰지 마세요.",
    ]
    return "\n".join(lines)


def to_script(data: dict[str, Any]) -> Script:
    """AI 가 준 JSON 을 `Script` 로 바꿉니다. 공급자가 달라도 같은 방식입니다."""
    scenes = [
        Scene(
            idx=int(s["idx"]),
            start_sec=float(s["start_sec"]),
            end_sec=float(s["end_sec"]),
            render_mode=RenderMode(s["render_mode"]),
            narration=s.get("narration", ""),
            screen_text=s.get("screen_text", ""),
            image_prompt=s.get("image_prompt", ""),
            video_prompt=s.get("video_prompt", ""),
        )
        for s in data.get("scenes", [])
    ]
    return Script(
        hook=data.get("hook", ""),
        full_text=data.get("full_text", ""),
        scenes=scenes,
        title=data.get("title", ""),
        caption=data.get("caption", ""),
        hashtags=tuple(data.get("hashtags", [])),
    )


def retry_prompt(problems: list[Problem]) -> str:
    """형식을 벗어났을 때 「여기를 고쳐라」 하고 다시 보낼 글 (§6)."""
    항목 = "\n".join(
        f"- {p.where}: {p.message}" + (f" ({p.fix})" if p.fix else "")
        for p in problems)
    return ("방금 만든 대본이 규칙을 어겼습니다. 아래를 고쳐서 다시 만들어 주세요.\n\n"
            f"{항목}\n\n"
            "고칠 부분만 손보고 나머지는 그대로 두세요.")


def strict_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """OpenAI 의 엄격 모드(strict)가 받지 않는 열쇠말을 걷어냅니다.

    `minItems` · `maxItems` 는 엄격 모드에서 거부당합니다. 장면 개수 제한은
    프롬프트로 말하고, 어긴 답은 `check_script()` 가 잡습니다 —
    검사는 어차피 두 겹입니다.
    """
    빼는것 = {"minItems", "maxItems"}
    if isinstance(schema, dict):
        return {k: strict_schema(v) for k, v in schema.items() if k not in 빼는것}
    if isinstance(schema, list):
        return [strict_schema(v) for v in schema]
    return schema
