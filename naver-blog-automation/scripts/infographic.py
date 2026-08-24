# -*- coding: utf-8 -*-
"""
네이버 블로그용 인포그래픽 만들기 — 1200 × 1500 (4:5)

지키는 원칙
  · 본문을 그대로 옮겨 넣지 않습니다. **한 이미지 = 한 메시지.**
  · 50~70대가 5초 안에 알아보도록 크게, 대비 강하게 그립니다.
  · 한글을 직접 그리므로 글자가 깨지거나 오타가 나지 않습니다.
  · 만든 뒤 스스로 검사(QA)하고, 걸리면 글자 크기를 줄여 다시 그립니다.

쓰는 법
    python scripts/infographic.py --demo
    python scripts/infographic.py --post output/2026-W35/stock/2026-08-25
"""
from __future__ import annotations

import argparse
import datetime as _dt
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

import yaml
from PIL import Image, ImageDraw, ImageFont

PROJECT_ROOT = Path(__file__).resolve().parent.parent
KST = _dt.timezone(_dt.timedelta(hours=9), "KST")

# ══════════════════════════════════════════════════════════════
# 고정 디자인 시스템
# ══════════════════════════════════════════════════════════════
W, H = 1200, 1500
MARGIN = 84                 # 좌우 안전 여백
TOP_PAD = 80                # 위 여백 (5% 이상)
BOTTOM_PAD = 80             # 아래 여백

NAVY = (11, 42, 85)         # #0B2A55
DEEP = (18, 63, 122)        # #123F7A
GREEN = (22, 138, 82)       # 상승·안전·긍정
RED = (192, 45, 40)         # 하락·위험·주의
YELLOW = (247, 190, 45)     # 핵심 강조
WHITE = (255, 255, 255)
CARD = (247, 249, 252)
INK = (23, 30, 42)
SUB = (72, 84, 99)
LINE = (206, 216, 228)

FB = r"C:\Windows\Fonts\malgunbd.ttf"   # 굵게
FR = r"C:\Windows\Fonts\malgun.ttf"     # 보통

# 글자 크기 (1200×1500 기준)
S_TITLE = 74
S_SUB = 40
S_CARD = 46
S_BODY = 36
S_NUM = 112                 # 숫자 강조 — 본문의 1.5배 이상
S_FOOT = 38

_font_cache: dict[tuple[str, int], ImageFont.FreeTypeFont] = {}


def f(path: str, size: int) -> ImageFont.FreeTypeFont:
    key = (path, size)
    if key not in _font_cache:
        _font_cache[key] = ImageFont.truetype(path, size)
    return _font_cache[key]


# ── 글자 그리기 도구 ────────────────────────────────────────
def tw(d: ImageDraw.ImageDraw, text: str, font) -> int:
    l, _, r, _ = d.textbbox((0, 0), text, font=font)
    return r - l


def center(d, xy, text, font, fill):
    x, y = xy
    l, t, r, b = d.textbbox((0, 0), text, font=font)
    d.text((x - (r - l) / 2 - l, y - (b - t) / 2 - t), text, font=font, fill=fill)


def left(d, xy, text, font, fill):
    x, y = xy
    l, t, _, b = d.textbbox((0, 0), text, font=font)
    d.text((x - l, y - (b - t) / 2 - t), text, font=font, fill=fill)


def fit_font(d, text: str, path: str, start: int, max_w: int, floor: int = 24):
    """글자가 칸을 넘지 않을 때까지 크기를 줄입니다."""
    size = start
    while size > floor and tw(d, text, f(path, size)) > max_w:
        size -= 2
    return f(path, size)


def wrap(d, text: str, font, max_w: int, max_lines: int = 2) -> list[str]:
    """띄어쓰기 기준으로 줄을 나눕니다. 넘치면 마지막 줄에 … 를 붙입니다."""
    words = text.split()
    lines, cur = [], ""
    for w_ in words:
        cand = (cur + " " + w_).strip()
        if tw(d, cand, font) <= max_w or not cur:
            cur = cand
        else:
            lines.append(cur)
            cur = w_
            if len(lines) == max_lines:
                break
    if cur and len(lines) < max_lines:
        lines.append(cur)
    if len(lines) == max_lines and words:
        joined = " ".join(lines)
        if len(joined) < len(text):
            while lines and tw(d, lines[-1] + "…", font) > max_w:
                lines[-1] = lines[-1][:-1]
            lines[-1] += "…"
    return lines


# ══════════════════════════════════════════════════════════════
# 이미지 사양 (분석 결과가 이 모양으로 정리됩니다)
# ══════════════════════════════════════════════════════════════
@dataclass
class Spec:
    kind: str                       # compare | three | flow | metaphor | chart
    title: str
    points: list[str] = field(default_factory=list)
    footer: str = ""
    left_label: str = ""
    right_label: str = ""
    left_items: list[str] = field(default_factory=list)
    right_items: list[str] = field(default_factory=list)
    numbers: list[str] = field(default_factory=list)   # points 와 짝을 이루는 큰 숫자
    chart_up: bool = True
    topic_slug: str = "infographic"
    authored: bool = False          # True = 원고가 직접 쓴 문구, False = 자동 초안


# ══════════════════════════════════════════════════════════════
# 공통 뼈대 — 제목·바닥 메시지
# ══════════════════════════════════════════════════════════════
def _canvas() -> tuple[Image.Image, ImageDraw.ImageDraw]:
    im = Image.new("RGB", (W, H), WHITE)
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, W, 262], fill=NAVY)
    return im, d


def _title(d, text: str) -> int:
    """제목을 그리고 다음 내용이 시작될 y 를 돌려줍니다."""
    inner = W - MARGIN * 2
    font = f(FB, S_TITLE)
    lines = wrap(d, text, font, inner, max_lines=2)
    if len(lines) == 1:
        font = fit_font(d, lines[0], FB, S_TITLE, inner, floor=44)
        center(d, (W / 2, TOP_PAD + 46), lines[0], font, WHITE)
        bar_y = TOP_PAD + 46 + font.size / 2 + 26
    else:
        font = fit_font(d, max(lines, key=len), FB, S_TITLE - 10, inner, floor=38)
        for i, ln in enumerate(lines):
            center(d, (W / 2, TOP_PAD + 4 + i * (font.size + 12)), ln, font, WHITE)
        bar_y = TOP_PAD + 4 + (len(lines) - 1) * (font.size + 12) + font.size / 2 + 24
    d.rectangle([W / 2 - 70, bar_y, W / 2 + 70, bar_y + 8], fill=YELLOW)
    return int(bar_y) + 66


def _footer(d, text: str) -> None:
    if not text:
        return
    inner = W - MARGIN * 2 - 60
    font = f(FB, S_FOOT)
    lines = wrap(d, text, font, inner, max_lines=2)
    box_h = 60 + len(lines) * (font.size + 12)
    top = H - BOTTOM_PAD - box_h
    d.rounded_rectangle([MARGIN, top, W - MARGIN, top + box_h], radius=22, fill=NAVY)
    for i, ln in enumerate(lines):
        center(d, (W / 2, top + 34 + i * (font.size + 12) + font.size / 2), ln, font, WHITE)


def _footer_top() -> int:
    return H - BOTTOM_PAD - 150


# ══════════════════════════════════════════════════════════════
# A. 비교형
# ══════════════════════════════════════════════════════════════
def draw_compare(s: Spec) -> Image.Image:
    im, d = _canvas()
    top = _title(d, s.title) + 26          # 제목 띠와 붙지 않게 띄웁니다
    bottom = _footer_top() - 30
    col_w = (W - MARGIN * 2 - 90) // 2
    y = top
    height = bottom - top

    font = f(FR, S_BODY)
    pairs = ((s.left_label, s.left_items, GREEN), (s.right_label, s.right_items, RED))
    wrapped = [[wrap(d, it, font, col_w - 56, 2) for it in items[:4]]
               for _, items, _ in pairs]

    for idx, ((label, items, color), cols) in enumerate(zip(pairs, wrapped)):
        x = MARGIN + idx * (col_w + 90)
        d.rounded_rectangle([x, y, x + col_w, y + height], radius=24, fill=CARD,
                            outline=color, width=5)
        d.rounded_rectangle([x, y, x + col_w, y + 96], radius=24, fill=color)
        d.rectangle([x, y + 70, x + col_w, y + 96], fill=color)
        center(d, (x + col_w / 2, y + 48),
               label, fit_font(d, label, FB, S_CARD, col_w - 40, 30), WHITE)

        # 머리띠 아래 남은 칸을 항목 수만큼 나누어 한가운데씩 놓습니다.
        # (위쪽에 몰아 놓으면 기둥 아래가 휑합니다)
        body_top, body_h = y + 96, height - 96
        n = max(1, len(cols))
        slot = body_h / n
        for i, lines in enumerate(cols):
            cy = body_top + slot * (i + 0.5)
            yy = cy - (len(lines) - 1) * (font.size + 12) / 2
            for ln in lines:
                center(d, (x + col_w / 2, yy), ln, font, INK)
                yy += font.size + 12
            if i:                                  # 항목 사이 옅은 구분선
                ly = body_top + slot * i
                d.line([x + 40, ly, x + col_w - 40, ly], fill=LINE, width=2)

    cx, cy = W / 2, y + height / 2
    d.ellipse([cx - 46, cy - 46, cx + 46, cy + 46], fill=YELLOW)
    center(d, (cx, cy), "VS", f(FB, 40), NAVY)

    _footer(d, s.footer)
    return im


# ══════════════════════════════════════════════════════════════
# B. 3단 요약형
# ══════════════════════════════════════════════════════════════
def draw_three(s: Spec) -> Image.Image:
    im, d = _canvas()
    y = _title(d, s.title)
    bottom = _footer_top() - 30
    n = max(1, min(4, len(s.points)))
    gap = 26
    avail = bottom - y
    card_h = min((avail - gap * (n - 1)) // n, 280)   # 5070 화면에서 크게 보이게
    block = card_h * n + gap * (n - 1)
    y0 = y + max(0, (avail - block) // 2)      # 남은 공간 가운데로

    colors = [DEEP, DEEP, GREEN, YELLOW]
    for i, pt in enumerate(s.points[:n]):
        top = y0 + i * (card_h + gap)
        col = colors[i % len(colors)]
        d.rounded_rectangle([MARGIN, top, W - MARGIN, top + card_h],
                            radius=24, fill=CARD, outline=col, width=5)
        # 번호 동그라미
        r = min(52, card_h * 0.26)
        cx = MARGIN + 52 + r
        cy = top + card_h / 2
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=col)
        center(d, (cx, cy), str(i + 1), f(FB, int(r * 1.25)),
               NAVY if col is YELLOW else WHITE)

        tx = cx + r + 44
        avail = W - MARGIN - 44 - tx
        num = s.numbers[i] if i < len(s.numbers) else ""
        if num:
            nf = fit_font(d, num, FB, S_NUM, 300, 48)
            left(d, (tx, cy), num, nf, col)
            tx += tw(d, num, nf) + 34
            avail = W - MARGIN - 44 - tx
        font = f(FB, S_CARD)
        lines = wrap(d, pt, font, avail, 2)
        if len(lines) == 1:
            left(d, (tx, cy), lines[0],
                 fit_font(d, lines[0], FB, S_CARD, avail, 26), INK)
        else:
            font = fit_font(d, max(lines, key=len), FB, S_CARD - 6, avail, 24)
            for j, ln in enumerate(lines):
                left(d, (tx, cy - font.size / 2 - 6 + j * (font.size + 10)), ln, font, INK)

    _footer(d, s.footer)
    return im


# ══════════════════════════════════════════════════════════════
# C. 흐름형
# ══════════════════════════════════════════════════════════════
def draw_flow(s: Spec) -> Image.Image:
    im, d = _canvas()
    y = _title(d, s.title)
    bottom = _footer_top() - 30
    n = max(2, min(4, len(s.points)))
    arrow = 58
    avail = bottom - y
    box_h = min((avail - arrow * (n - 1)) // n, 190)
    block = box_h * n + arrow * (n - 1)
    y0 = y + max(0, (avail - block) // 2)

    for i, pt in enumerate(s.points[:n]):
        top = y0 + i * (box_h + arrow)
        col = [DEEP, DEEP, GREEN, GREEN][i % 4]
        d.rounded_rectangle([MARGIN + 40, top, W - MARGIN - 40, top + box_h],
                            radius=22, fill=CARD, outline=col, width=5)
        font = f(FB, S_CARD)
        inner = W - (MARGIN + 40) * 2 - 60
        lines = wrap(d, pt, font, inner, 2)
        font = fit_font(d, max(lines, key=len), FB, S_CARD, inner, 26)
        for j, ln in enumerate(lines):
            center(d, (W / 2, top + box_h / 2 + (j - (len(lines) - 1) / 2) * (font.size + 10)),
                   ln, font, INK)
        if i < n - 1:
            ay = top + box_h + arrow / 2
            d.polygon([(W / 2 - 30, ay - 14), (W / 2 + 30, ay - 14), (W / 2, ay + 20)],
                      fill=YELLOW)

    _footer(d, s.footer)
    return im


# ══════════════════════════════════════════════════════════════
# D. 비유형
# ══════════════════════════════════════════════════════════════
def draw_metaphor(s: Spec) -> Image.Image:
    im, d = _canvas()
    y = _title(d, s.title)
    bottom = _footer_top() - 30

    # 위: 비유 그림 자리 (도형으로 단순하게)
    art_h = int((bottom - y) * 0.46)
    d.rounded_rectangle([MARGIN, y, W - MARGIN, y + art_h], radius=24,
                        fill=CARD, outline=LINE, width=4)

    cx = W / 2
    cy = y + art_h / 2
    left_label = s.left_label or "이것"
    right_label = s.right_label or "저것"

    # 왼쪽 한 덩어리 → 오른쪽 여러 덩어리 (분산·이동을 나타내는 기본 그림)
    d.ellipse([cx - 400, cy - 84, cx - 232, cy + 84], fill=RED)
    center(d, (cx - 316, cy), "1", f(FB, 84), WHITE)
    d.polygon([(cx - 150, cy - 26), (cx - 30, cy - 26), (cx - 30, cy - 54),
               (cx + 40, cy), (cx - 30, cy + 54), (cx - 30, cy + 26), (cx - 150, cy + 26)],
              fill=YELLOW)
    for i, dx in enumerate((100, 230, 360)):
        for j, dy in enumerate((-70, 70)):
            d.ellipse([cx + dx - 52, cy + dy - 52, cx + dx + 52, cy + dy + 52], fill=GREEN)

    center(d, (cx - 316, cy + 118), left_label,
           fit_font(d, left_label, FB, S_SUB, 320, 24), INK)
    center(d, (cx + 230, cy + 152), right_label,
           fit_font(d, right_label, FB, S_SUB, 460, 24), INK)

    # 아래: 핵심 포인트
    py = y + art_h + 36
    font = f(FB, S_CARD)
    for i, pt in enumerate(s.points[:3]):
        d.ellipse([MARGIN + 6, py + 10, MARGIN + 34, py + 38], fill=YELLOW)
        lines = wrap(d, pt, font, W - MARGIN * 2 - 80, 2)
        ff = fit_font(d, max(lines, key=len), FB, S_CARD, W - MARGIN * 2 - 80, 26)
        for j, ln in enumerate(lines):
            left(d, (MARGIN + 56, py + 24 + j * (ff.size + 8)), ln, ff, INK)
        py += 24 + len(lines) * (ff.size + 8) + 22

    _footer(d, s.footer)
    return im


# ══════════════════════════════════════════════════════════════
# E. 차트 교육형
# ══════════════════════════════════════════════════════════════
def draw_chart(s: Spec) -> Image.Image:
    im, d = _canvas()
    y = _title(d, s.title)
    bottom = _footer_top() - 30

    n_pt = min(3, len(s.points))
    art_h = int((bottom - y) * 0.52)
    block = art_h + 36 + n_pt * 110
    y = y + max(0, (bottom - y - block) // 2)
    d.rounded_rectangle([MARGIN, y, W - MARGIN, y + art_h], radius=24,
                        fill=CARD, outline=LINE, width=4)

    # 단순화한 캔들 — 실제 종목이 아니라 개념 설명용입니다.
    base_y = y + art_h - 70
    top_y = y + 60
    span = base_y - top_y
    xs = [MARGIN + 90 + i * 130 for i in range(7)]
    if s.chart_up:
        highs = [0.30, 0.38, 0.34, 0.52, 0.60, 0.74, 0.88]
    else:
        highs = [0.88, 0.78, 0.80, 0.60, 0.52, 0.38, 0.26]

    for i, x in enumerate(xs):
        h = highs[i]
        prev = highs[i - 1] if i else h - 0.02
        up = h >= prev
        col = RED if up else DEEP        # 한국 시장: 오르면 빨강
        cy_top = base_y - span * h
        cy_bot = base_y - span * prev
        lo, hi = min(cy_top, cy_bot), max(cy_top, cy_bot)
        d.line([(x, lo - 26), (x, hi + 26)], fill=col, width=5)
        d.rectangle([x - 26, lo, x + 26, hi if hi - lo > 12 else lo + 12], fill=col)

    # 추세선
    pts = [(x, base_y - span * h) for x, h in zip(xs, highs)]
    d.line(pts, fill=GREEN, width=6)

    center(d, (W / 2, y + art_h - 30),
           s.left_label or ("오르는 흐름" if s.chart_up else "내리는 흐름"),
           f(FB, S_SUB), SUB)

    py = y + art_h + 36
    font = f(FB, S_CARD)
    for pt in s.points[:3]:
        d.rounded_rectangle([MARGIN, py, W - MARGIN, py + 92], radius=18,
                            fill=CARD, outline=LINE, width=3)
        lines = wrap(d, pt, font, W - MARGIN * 2 - 60, 1)
        ff = fit_font(d, lines[0], FB, S_CARD, W - MARGIN * 2 - 60, 26)
        center(d, (W / 2, py + 46), lines[0], ff, INK)
        py += 110

    _footer(d, s.footer)
    return im


DRAWERS = {
    "compare": draw_compare,
    "three": draw_three,
    "flow": draw_flow,
    "metaphor": draw_metaphor,
    "chart": draw_chart,
}
KIND_KO = {
    "compare": "비교형", "three": "3단 요약형", "flow": "흐름형",
    "metaphor": "비유형", "chart": "차트 교육형",
}


# ══════════════════════════════════════════════════════════════
# STEP 1~2. 본문 분석 → 유형 선택
# ══════════════════════════════════════════════════════════════
COMPARE_HINTS = ("vs", "대신", "반대로", "차이", "어느 쪽", "좋은", "나쁜",
                 "양봉", "음봉", "상승", "하락", "몰빵", "분산")
FLOW_HINTS = ("내려가면", "오르면", "흘러", "이동", "때문에", "그래서",
              "원리", "이어서")
CHART_HINTS = ("캔들", "차트", "이동평균", "이평선", "거래량", "골든크로스",
               "데드크로스", "지지선", "저항선")
METAPHOR_HINTS = ("비유", "처럼", "같습니다", "바구니", "피자", "번호표",
                  "월세", "총알", "맛집", "항아리", "줄다리기", "물웅덩이")


# 이미지 안에 들어가면 안 되는 그림 글자들.
# 범위를 chr() 로 적어 두어 어느 편집기에서도 깨지지 않게 했습니다.
_EMOJI = re.compile(
    "[" + "".join(chr(a) + "-" + chr(b) for a, b in (
        (0x1F000, 0x1FAFF),   # 그림 이모지 전체
        (0x2190, 0x21FF),     # 화살표 (양방향 화살표 포함)
        (0x2300, 0x23FF),     # 시계·기호
        (0x2460, 0x24FF),     # 동그라미 숫자
        (0x25A0, 0x27BF),     # 도형·별표
        (0x2B00, 0x2BFF),     # 화살표 보충
    )) + chr(0xFE0F) + chr(0x200D) + "]"
)

# 뒤에 붙어도 뜻이 안 변하는 꼬리들 — 길면 떼어 냅니다.
# 낱말 중간이 끊기지 않도록 **앞에 공백이 오는 형태**로 적었습니다.
#   "움직일 수 있습니다" 에서 "일 수 있습니다" 를 떼면 "움직" 만 남아 뜻이 깨집니다.
_TAIL = (
    "하셔도 됩니다", "보셔도 됩니다", "하시면 됩니다", "보시면 됩니다",
    "것이 좋습니다", "수 있습니다", "수도 있습니다",
    "하지 않습니다", "합니다", "입니다", "됩니다", "있습니다", "세요",
)


def _shorten(text: str, n: int) -> str:
    """
    글자 수를 줄입니다. 되도록 **자르지 않고** 뜻이 온전하게 남깁니다.

      1) 공백·마침표·따옴표 정리
      2) 그래도 길면 문장 꼬리(서술어)를 뗍니다
      3) 마지막 수단으로만 낱말 경계에서 끊고 … 를 붙입니다

    쉼표로 쪼개지 않습니다. "코스피, 코스닥, 환율" 처럼 나열된 문장에서
    한 조각만 남기면 뜻이 깨지기 때문입니다.
    """
    t = " ".join(_EMOJI.sub("", text).split()).strip()
    t = t.strip('"\u201c\u201d\u2018\u2019 ').rstrip(". ")
    if len(t) <= n:
        return t

    for tail in _TAIL:
        if t.endswith(tail) and len(t) - len(tail) >= 8:
            t2 = t[: -len(tail)].rstrip(" ,")
            if not t2.split() or len(t2.split()[-1]) < 2:
                break              # 낱말이 깨졌으면 자르지 않습니다
            if len(t2) <= n:
                return t2
            t = t2
            break

    if len(t) <= n:
        return t
    cut = t[:n]
    if " " in cut[n // 2:]:
        cut = cut[: cut.rfind(" ")]
    return cut.rstrip(" ,") + "…"


_clip = _shorten


# 원고가 이미지 문구를 직접 지정하는 방법.
# post.md 앞머리(--- 사이)에 이렇게 적으면 자동 분석 대신 이 문구를 씁니다.
#
#   infographic:
#     kind: three              # compare | three | flow | metaphor | chart
#     title: 아침에 볼 숫자 세 개
#     points:
#       - 코스피와 코스닥
#       - 원·달러 환율
#       - 지난주와 견주기
#     footer: 방향만 보셔도 충분합니다
#     slug: weekly_check
#
# 왜 이렇게 했는가: 본문 문장은 35~50자인데 사양은 포인트를 10~25자로 요구합니다.
# 정규식으로 그 길이까지 줄이면 "다르게 움직" 처럼 뜻이 깨집니다.
# 그래서 최종 문구는 원고가 정하고, 자동 분석은 초안으로만 씁니다.
def _authored_spec(fm_text: str) -> Spec | None:
    try:
        fm = yaml.safe_load(fm_text) or {}
    except yaml.YAMLError:
        return None
    g = fm.get("infographic") if isinstance(fm, dict) else None
    if not isinstance(g, dict):
        return None

    kind = str(g.get("kind", "three")).strip()
    if kind not in DRAWERS:
        raise ValueError("infographic.kind 값이 '" + kind + "' 입니다. "
                         "쓸 수 있는 값: " + ", ".join(DRAWERS))

    def lines(key):
        v = g.get(key) or []
        if isinstance(v, str):
            v = [v]
        return [" ".join(str(x).split()) for x in v if str(x).strip()]

    s = Spec(
        kind=kind,
        title=" ".join(str(g.get("title", "")).split()),
        points=lines("points")[:4],
        footer=" ".join(str(g.get("footer", "")).split()),
        left_label=str(g.get("left_label", "")).strip(),
        right_label=str(g.get("right_label", "")).strip(),
        left_items=lines("left_items")[:4],
        right_items=lines("right_items")[:4],
        numbers=lines("numbers")[:4],
        chart_up=bool(g.get("chart_up", True)),
        authored=True,
    )
    if g.get("slug"):
        s.topic_slug = str(g["slug"]).strip()
    if not s.title:
        raise ValueError("infographic.title 이 비어 있습니다")
    if kind == "compare" and not (s.left_items and s.right_items):
        raise ValueError("비교형은 left_items 와 right_items 가 모두 있어야 합니다")
    if kind != "compare" and not s.points:
        raise ValueError("infographic.points 가 비어 있습니다")
    return s


def analyze(post_md: Path) -> Spec:
    """
    원고를 읽고 이미지 사양을 만듭니다.

    본문을 옮겨 적지 않습니다. 제목 한 개, 핵심 2~4개, 바닥 한 줄만 뽑습니다.
    """
    raw = post_md.read_text(encoding="utf-8")
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n(.*)$", raw, re.S)
    fm_text, body = (m.group(1), m.group(2)) if m else ("", raw)

    # 원고가 문구를 직접 적어 두었으면 그대로 씁니다.
    authored = _authored_spec(fm_text)
    if authored is not None:
        if authored.topic_slug == "infographic":
            authored.topic_slug = re.sub(
                r"[^a-z0-9_]+", "_", post_md.parent.parent.name.lower()).strip("_") or "post"
        return authored

    mt = re.search(r"^title:\s*['\"]?(.*?)['\"]?$", fm_text, re.M)
    title_raw = mt.group(1) if mt else ""
    # 말머리와 이모지를 떼어 짧은 제목으로 만듭니다.
    title = re.sub(r"^\[[^\]]*\]\s*-?\s*", "", title_raw)
    title = _EMOJI.sub("", title)
    title = title.strip(" '\"\u201c\u201d-·")
    # 큰따옴표로 감싼 '독자의 질문' 은 떼고 설명부만 남깁니다.
    #   "이 코인 믿어도 되나요?" 백서에서 딱 세 곳만 보는 법  →  백서에서 딱 세 곳만 보는 법
    mq = re.match(r'^[\"\u201c]?[^\"\u201c\u201d]{4,}[\"\u201d]\s*(.+)$', title)
    if mq and len(mq.group(1).strip()) >= 8:
        title = mq.group(1).strip()
    title = title.strip(" '\"\u201c\u201d-·")
    # 제목이 길고 쉼표가 있으면 **뒤쪽 절**을 씁니다.
    #   "회사가 돈을 잘 버는지 보는 자, ROE 3분 만에 이해하기" → 뒤쪽에 핵심어가 있습니다.
    if len(title) > 24 and "," in title:
        tail_part = title.split(",")[-1].strip(" '\"\u201c\u201d")
        if len(tail_part) >= 8:
            title = tail_part
    title = _shorten(title or "오늘의 정리", 24)

    plain = re.sub(r"\[이미지:[^\]]+\]", "", body).replace("\u200b", " ")
    low = plain.lower()

    # ── 본문 꼬리(댓글 유도·유의문구·소개·해시태그)는 잘라 냅니다 ──
    STOP = ("댓글 질문", "이 글은 주식과 경제", "이글은 주식과 경제",
            "오락(ORAK) 5070", "추천 검색 키워드", "오늘 하루도",
            "오늘도 뇌동매매", "본 포스팅은", "함께 읽으면 좋은")
    cut_at = len(plain)
    for st in STOP:
        i = plain.find(st)
        if i != -1:
            cut_at = min(cut_at, i)
    body_only = plain[:cut_at]

    # ── 핵심 포인트 뽑기 ────────────────────────────────────
    points: list[str] = []
    sec = re.search(r"##[^\n]*?(?:3줄 정리|3줄 요약|한 줄 요약)[^\n]*\n(.*?)(?=\n##|\Z)",
                    plain, re.S)
    if sec:
        block = sec.group(1)
        for st in STOP:
            i = block.find(st)
            if i != -1:
                block = block[:i]
        for ln in block.split("\n"):
            s = ln.strip().lstrip("0123456789. ").strip('>"\u201c\u201d ').strip()
            if 6 <= len(s) <= 80:
                points.append(_shorten(s, 40))
    if len(points) < 2:
        for m2 in re.finditer(r"\*\*(?:첫째|둘째|셋째|하나|둘|셋)[,.]?\s*(.*?)\*\*", body_only):
            points.append(_shorten(m2.group(1).strip(' "\u201c\u201d'), 40))
    if len(points) < 2:
        for m3 in re.finditer(r"^##\s+(.*)$", body_only, re.M):
            s = _EMOJI.sub("", m3.group(1))
            s = re.sub(r"^\d+\.\s*", "", s).strip()
            s = re.sub(r"^(?:아웃트로|들어가며|마무리)\s*[:：]\s*", "", s)
            s = re.sub(r"\s*\([^)]*\)\s*$", "", s).strip()   # 끝의 괄호 부제 제거
            if s and "요약" not in s and "정리" not in s and "아웃트로" not in s:
                points.append(_shorten(s, 40))
    points = [p for p in points if p][:4] or ["핵심을 정리했습니다"]

    # ── 바닥 한 줄 ──────────────────────────────────────────
    footer = ""
    fq = re.search(r"^>\s*[\u201c\"]?(.+?)[\u201d\"]?\s*$", body_only, re.M)
    if fq:
        footer = _shorten(fq.group(1), 46)
    if footer and any(footer[:12] in pt or pt[:12] in footer for pt in points):
        footer = ""

    # ── 유형 판단 ───────────────────────────────────────────
    def score(hints) -> int:
        return sum(1 for h in hints if h in low)

    kinds = {
        "chart": score(CHART_HINTS) * 2,
        "metaphor": score(METAPHOR_HINTS),
        "flow": score(FLOW_HINTS),
        "compare": score(COMPARE_HINTS),
        "three": 2,
    }
    kind = max(kinds, key=lambda k: kinds[k])
    # 정리 절에서 뽑은 포인트가 2개 이상이면 3단 요약형이 가장 잘 읽힙니다.
    # 다른 유형은 뚜렷한 신호(3점 이상)가 있을 때만 씁니다.
    if len(points) >= 2 and kinds[kind] < 4:
        kind = "three"

    # 포인트가 4개면 마지막 하나를 바닥 한 줄로 올립니다.
    # 유형을 정한 뒤에 해야 합니다. 먼저 줄이면 유형 판단이 흔들립니다.
    if not footer and len(points) >= 4:
        footer = _shorten(points[-1], 44)
        points = points[:-1]

    spec = Spec(kind=kind, title=title, points=points, footer=footer)
    spec.chart_up = ("상승" in plain) or ("오르" in plain)

    if kind == "compare":
        spec.left_label, spec.right_label = "이렇게 하세요", "이건 피하세요"
        half = max(1, len(points) // 2)
        spec.left_items = points[:half]
        spec.right_items = points[half:] or ["반대로 하면 위험합니다"]
    if kind == "metaphor":
        spec.left_label, spec.right_label = "한 곳에 몰기", "나누어 담기"

    # ── 파일 이름에 쓸 영문 조각 ────────────────────────────
    rom = {
        "코스피": "kospi", "코스닥": "kosdaq", "환율": "fx", "배당주": "dividend",
        "분산투자": "diversification", "비트코인도미넌스": "dominance",
        "비트코인": "bitcoin", "이더리움": "ethereum", "금리": "interest_rate",
        "주식초보": "stock_basic", "원달러환율": "fx", "주간시황": "weekly_market",
    }
    slug = "topic"
    kw = re.search(r"^keywords:\s*\n((?:[ \t]*-[ \t]*.*\n)+)", fm_text, re.M)
    if kw:
        first = kw.group(1).split("\n")[0].strip().lstrip("- ").strip()
        slug = rom.get(first, "topic")
    spec.topic_slug = re.sub(r"[^a-z0-9_]+", "_", slug).strip("_")[:28] or "infographic"
    return spec


# ══════════════════════════════════════════════════════════════
# QA — 걸리면 다시 그립니다
# ══════════════════════════════════════════════════════════════
def qa(im: Image.Image, s: Spec) -> list[str]:
    bad: list[str] = []
    if im.size != (W, H):
        bad.append(f"규격이 {im.size} 입니다 (기대 {W}x{H})")

    # 맨 위·아래 줄에 내용이 닿았는지 봅니다.
    px = im.load()
    for y in (4, H - 5):
        row = {px[x, y] for x in range(0, W, 7)}
        if len(row) > 3:
            bad.append(f"y={y} 줄에 내용이 닿았습니다 (여백 부족)")

    if not s.title:
        bad.append("제목이 없습니다")
    elif len(s.title) > 26:
        bad.append(f"제목이 {len(s.title)}자입니다 (26자 이내 권장)")
    if s.kind == "compare":
        if not (s.left_items and s.right_items):
            bad.append("비교형인데 좌우 항목이 비어 있습니다")
    elif not s.points:
        bad.append("핵심 포인트가 없습니다")
    elif len(s.points) > 4:
        bad.append(f"핵심 포인트가 {len(s.points)}개입니다 (4개 이내)")
    for p in s.points:
        if len(p) > 44:
            bad.append(f"포인트가 깁니다({len(p)}자): {p[:20]}")
    if len(s.footer) > 50:
        bad.append(f"바닥 문장이 {len(s.footer)}자입니다 (50자 이내)")
    return bad


# ══════════════════════════════════════════════════════════════
# 저장 — JPEG q95, 이름 중복 방지
# ══════════════════════════════════════════════════════════════
def save_jpeg(im: Image.Image, out_dir: Path, slug: str) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = _dt.datetime.now(KST).strftime("%Y%m%d")
    base = f"{stamp}_{slug}"
    path = out_dir / f"{base}.jpg"
    n = 1
    while path.exists():
        path = out_dir / f"{base}_{n:02d}.jpg"
        n += 1
    im.convert("RGB").save(path, "JPEG", quality=95, optimize=True)
    return path


def build(spec: Spec, out_dir: Path) -> tuple[Path, list[str]]:
    """그리고 → 검사하고 → 걸리면 줄여서 다시 그리고 → 저장합니다."""
    problems: list[str] = []
    im = None
    for _ in range(3):
        im = DRAWERS[spec.kind](spec)
        problems = qa(im, spec)
        if not problems:
            break
        spec.title = _shorten(spec.title, 22)
        spec.points = [_shorten(p, 36) for p in spec.points][:4]
        spec.footer = _shorten(spec.footer, 44)
    return save_jpeg(im, out_dir, spec.topic_slug), problems


# ══════════════════════════════════════════════════════════════
def default_out_dir() -> Path:
    """
    저장 폴더.

    사양에 적힌 C:\\Users\\admin\\... 은 이 PC에 없습니다.
    이 PC 바탕화면 아래 '블로그 이미지' 를 씁니다.
    """
    import os
    return Path(os.path.expandvars(r"%USERPROFILE%\Desktop\블로그 이미지"))


DEMO = [
    ("three", "오늘의 3줄 정리",
     ["아침 시작 가격보다 오르면 빨간 막대", "내리면 파란 막대입니다",
      "어제 가격이 아니라 오늘 시작가 기준"],
     "막대 색은 오늘 시작가와 견준 결과입니다.", "candle_basic"),
    ("compare", "몰빵과 분산, 무엇이 다를까요", [],
     "분산은 대박이 아니라 지키기 위한 것입니다.", "diversification"),
    ("flow", "금리가 내려가면 왜 주가가 오를까요",
     ["금리 인하", "예금 이자 매력 감소", "돈이 주식시장으로 이동", "주가 상승 압력"],
     "돈은 이자가 낮아지면 다른 곳을 찾습니다.", "interest_rate_stock"),
    ("metaphor", "분산투자는 계란 바구니입니다",
     ["한 바구니면 넘어질 때 다 깨집니다", "나누면 하나 떨어져도 남습니다",
      "성격이 다른 곳에 나누세요"],
     "대박이 아니라 지키기 위한 습관입니다.", "egg_basket"),
    ("chart", "이동평균선 3분 만에 보기",
     ["캔들이 선 위에 있으면 오르는 흐름", "아래에 있으면 내리는 흐름",
      "하루가 아니라 방향을 보세요"],
     "선 하나로 큰 흐름을 알 수 있습니다.", "moving_average"),
]


def main() -> int:
    ap = argparse.ArgumentParser(description="네이버 블로그용 인포그래픽 만들기")
    ap.add_argument("--post", help="원고 폴더 (post.md 가 있는 곳)")
    ap.add_argument("--kind", choices=list(DRAWERS), help="유형을 직접 지정")
    ap.add_argument("--out", help="저장 폴더")
    ap.add_argument("--demo", action="store_true", help="다섯 유형 견본을 한 번에 만듭니다")
    args = ap.parse_args()

    out_dir = Path(args.out) if args.out else default_out_dir()

    if args.demo:
        print()
        for kind, title, points, footer, slug in DEMO:
            sp = Spec(kind=kind, title=title, points=points, footer=footer, topic_slug=slug)
            if kind == "compare":
                sp.left_label, sp.right_label = "나누어 담기", "한 곳에 몰기"
                sp.left_items = ["한 바구니가 깨져도 남습니다", "성격이 다른 곳에 나눕니다"]
                sp.right_items = ["한 번에 반토막 날 수 있습니다", "밤에 잠이 오지 않습니다"]
            if kind == "metaphor":
                sp.left_label, sp.right_label = "한 바구니", "나눈 바구니"
            if kind == "chart":
                sp.chart_up = True
                sp.left_label = "오르는 흐름"
            path, probs = build(sp, out_dir)
            print(f"  {'OK' if not probs else '△ '} {KIND_KO[sp.kind]:9s} {path.name}")
            for p in probs:
                print(f"       - {p}")
        print()
        print(f"  저장 폴더: {out_dir}")
        print()
        return 0

    if not args.post:
        ap.error("--post 또는 --demo 중 하나가 필요합니다")

    pdir = Path(args.post)
    post_md = pdir / "post.md" if pdir.is_dir() else pdir
    if not post_md.exists():
        print(f"  [오류] 원고를 찾지 못했습니다: {post_md}")
        return 1

    spec = analyze(post_md)
    if args.kind:
        spec.kind = args.kind
    path, probs = build(spec, out_dir)

    print()
    print("=" * 46)
    print()
    print("  네이버 블로그 이미지 제작 완료")
    print()
    print(f"  주제        : {spec.title}")
    print(f"  이미지 유형 : {KIND_KO[spec.kind]}")
    print(f"  문구 출처   : "
          + ("원고가 지정한 문구" if spec.authored
             else "자동 초안 (원고 앞머리에 infographic: 블록을 넣으면 직접 지정할 수 있습니다)"))
    print(f"  규격        : {W} x {H}")
    print("  파일 형식   : JPEG (품질 95)")
    print(f"  저장 위치   : {path.parent}")
    print(f"  파일명      : {path.name}")
    print()
    if probs:
        print("  검수에서 걸린 것 (줄여서 다시 그렸습니다)")
        for p in probs:
            print(f"    - {p}")
        print()
    print("=" * 46)
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
