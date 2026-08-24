# -*- coding: utf-8 -*-
"""
OpenAI 공식 Image API 직접 호출.

브라우저를 사람처럼 클릭하거나 화면을 캡처하지 않습니다.
HTTPS 로 공식 엔드포인트에 요청하고 이미지 바이트를 그대로 받습니다.

키는 .env 에서만 읽고, 화면·로그·오류 메시지에 찍지 않습니다.
"""

from __future__ import annotations

import base64
import binascii
import json
import re
import time
from pathlib import Path

import requests

from .paths import load_env, load_style

# 키처럼 보이는 값을 오류 메시지에서 가립니다.
_SECRET = [
    re.compile(r"((?:api[_-]?key|apikey|token|authorization)\s*[:=]\s*)\S+", re.I),
    re.compile(r"\bsk-[A-Za-z0-9_\-]{8,}\b"),
    re.compile(r"\b[A-Za-z0-9_\-]{40,}\b"),
]


def mask_secrets(text: str) -> str:
    out = str(text)
    out = _SECRET[0].sub(r"\1***", out)
    out = _SECRET[1].sub("sk-***", out)
    out = _SECRET[2].sub("***", out)
    return out


class ImageApiError(RuntimeError):
    """이미지 API 호출이 실패했을 때. 메시지에는 키가 들어가지 않습니다."""


# ══════════════════════════════════════════════════════════════
# 1. 프롬프트 작성
# ══════════════════════════════════════════════════════════════
_TYPE_GUIDE = {
    "compare": "두 칸으로 나눈 좌우 비교 그림. 왼쪽은 녹색 계열, 오른쪽은 붉은색 계열.",
    "three": "세로로 쌓은 카드 3장. 각 카드에 큰 번호와 짧은 문구 한 줄.",
    "flow": "위에서 아래로 이어지는 화살표 흐름도. 단계마다 상자 하나.",
    "metaphor": "쉬운 사물에 빗댄 그림 한 장과 짧은 설명 카드.",
    "chart": "단순한 막대 또는 선 그래프 한 개와 설명 카드. 눈금 숫자는 넣지 않음.",
}


def build_prompt(spec: dict, style: dict | None = None) -> str:
    """
    분석 결과를 이미지 생성 프롬프트로 바꿉니다.

    본문을 그대로 넣지 않습니다. 제목 하나, 핵심 2~4개, 바닥 한 줄만 넣습니다.
    """
    style = style or load_style()
    c = style["colors"]
    cv = style["canvas"]
    tr = style["text_rules"]

    lines: list[str] = []
    lines.append("한국어 인포그래픽 포스터 한 장을 그려 주세요. 사진이 아니라 벡터 스타일의 편집 디자인입니다.")
    lines.append("")
    lines.append(f"[규격] 세로형 {cv['aspect']} ({cv['width']}x{cv['height']} 비율). 여백을 넉넉히 둡니다.")
    lines.append(f"[유형] {style['types'][spec['kind']]} — {_TYPE_GUIDE[spec['kind']]}")
    lines.append("")
    lines.append("[색]")
    lines.append(f"  배경·제목 띠 : {c['navy']}")
    lines.append(f"  카드 배경    : {c['deep_blue']}")
    lines.append(f"  좋은 쪽·상승 : {c['green']}")
    lines.append(f"  나쁜 쪽·하락 : {c['red']}")
    lines.append(f"  강조선·숫자  : {c['yellow']}")
    lines.append(f"  글자         : {c['white']}")
    lines.append("  이 여섯 가지 색만 씁니다. 그라데이션과 그림자는 쓰지 않습니다.")
    lines.append("")
    lines.append("[화면에 넣을 한국어 글자 — 아래 문장을 글자 하나 바꾸지 말고 그대로 넣습니다]")
    lines.append(f"  제목: {spec['title']}")
    if spec["kind"] == "compare" and spec.get("left_items"):
        lines.append(f"  왼쪽 제목: {spec.get('left_label', '')}")
        for it in spec["left_items"]:
            lines.append(f"    - {it}")
        lines.append(f"  오른쪽 제목: {spec.get('right_label', '')}")
        for it in spec["right_items"]:
            lines.append(f"    - {it}")
    else:
        for i, p in enumerate(spec["points"], 1):
            lines.append(f"  {i}. {p}")
    if spec.get("footer"):
        lines.append(f"  아래 띠 문구: {spec['footer']}")
    lines.append("")
    lines.append("[글자 규칙]")
    lines.append(f"  · 위에 적은 문장 말고 다른 글자는 넣지 않습니다. 영어 단어도 넣지 않습니다.")
    lines.append(f"  · 제목은 최대 {tr['title_max_lines']}줄로 배치합니다.")
    lines.append(f"  · 숫자와 핵심 낱말은 주변 글자보다 최소 {tr['number_scale_vs_body']}배 크게 합니다.")
    lines.append("  · 맞춤법을 지킨 정확한 한글로 씁니다. 글자가 깨지거나 흐릿하면 안 됩니다.")
    lines.append("")
    lines.append(f"[보는 사람] {style['audience']['이름']}")
    for r in style["audience"]["규칙"]:
        lines.append(f"  · {r}")
    lines.append("")
    lines.append("[넣지 않는 것]")
    for f in style["forbidden"]:
        lines.append(f"  · {f}")
    lines.append("")
    lines.append("한 이미지에 한 가지 메시지만 담습니다.")
    return "\n".join(lines)


# ══════════════════════════════════════════════════════════════
# 2. API 호출
# ══════════════════════════════════════════════════════════════
def _image_bytes_from(payload: dict, timeout: int) -> bytes:
    """응답에서 이미지 바이트를 꺼냅니다. b64_json 과 url 을 모두 받습니다."""
    data = (payload or {}).get("data") or []
    if not data:
        raise ImageApiError("응답에 이미지가 없습니다. (data 가 비어 있습니다)")
    item = data[0]

    if item.get("b64_json"):
        try:
            return base64.b64decode(item["b64_json"], validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ImageApiError(f"이미지를 해독하지 못했습니다: {exc}") from exc

    if item.get("url"):
        r = requests.get(item["url"], timeout=timeout)
        if r.status_code != 200:
            raise ImageApiError(f"이미지 내려받기 실패: HTTP {r.status_code}")
        return r.content

    raise ImageApiError("응답에 b64_json 도 url 도 없습니다.")


def generate_image(prompt: str, style: dict | None = None) -> tuple[bytes, dict]:
    """
    OpenAI 공식 Image API 를 호출해 이미지 바이트를 받아 옵니다.

    돌려주는 값: (이미지 바이트, 호출 정보 dict)
    실패하면 ImageApiError 를 올립니다. 키는 메시지에 들어가지 않습니다.
    """
    style = style or load_style()
    api = style["api"]
    env = load_env()

    key = env.get("OPENAI_API_KEY", "").strip()
    if not key:
        raise ImageApiError(
            "OPENAI_API_KEY 가 없습니다.\n"
            "  1) .env.example 을 복사해 .env 로 이름을 바꾸세요.\n"
            "  2) OPENAI_API_KEY= 뒤에 키를 붙여 넣고 저장하세요.\n"
            "  (.env 는 .gitignore 에 있어 깃허브에 올라가지 않습니다)")

    model = (env.get("OPENAI_IMAGE_MODEL") or api["model_default"]).strip()
    timeout = int(api["timeout_seconds"])
    body = {
        "model": model,
        "prompt": prompt,
        "size": api["request_size"],
        "n": 1,
    }
    if api.get("quality"):
        body["quality"] = api["quality"]

    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    last = ""
    for attempt in range(int(api["max_retries"]) + 1):
        try:
            r = requests.post(api["endpoint"], headers=headers,
                              data=json.dumps(body).encode("utf-8"), timeout=timeout)
        except requests.RequestException as exc:
            last = mask_secrets(f"연결 실패: {exc}")
        else:
            if r.status_code == 200:
                info = {"model": model, "size": api["request_size"],
                        "endpoint": api["endpoint"], "attempts": attempt + 1}
                return _image_bytes_from(r.json(), timeout), info

            detail = ""
            try:
                detail = (r.json().get("error") or {}).get("message", "")
            except ValueError:
                detail = r.text[:200]
            last = mask_secrets(f"HTTP {r.status_code} {detail}".strip())

            if r.status_code == 429:
                wait = int(r.headers.get("Retry-After") or 20)
                if attempt < int(api["max_retries"]):
                    time.sleep(min(wait, 60))
                    continue
            elif 400 <= r.status_code < 500 and r.status_code != 408:
                break      # 키·모델명·프롬프트 문제는 다시 걸어도 같습니다

        if attempt < int(api["max_retries"]):
            time.sleep(2 * (attempt + 1))

    raise ImageApiError(f"이미지 생성에 실패했습니다. (모델 {model})\n  마지막 오류: {last}")


def save_prompt(prompt: str, out_dir: Path, slug: str, stamp: str) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"{stamp}_{slug}.txt"
    n = 1
    while path.exists():
        path = out_dir / f"{stamp}_{slug}_{n:02d}.txt"
        n += 1
    path.write_text(prompt, encoding="utf-8")
    return path
