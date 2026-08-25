# -*- coding: utf-8 -*-
"""정리 그림(인포그래픽) 만들기 자체 검사.

인터넷을 쓰지 않습니다. 임시 폴더에서만 돌아갑니다.
    .venv\\Scripts\\python.exe scripts/test_infographic.py
"""
from __future__ import annotations

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import infographic as ig                                   # noqa: E402
from PIL import Image                                      # noqa: E402

ok = 0
bad: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    global ok
    if cond:
        ok += 1
        print(f"  ✅ {name}")
    else:
        bad.append(name + (f" — {detail}" if detail else ""))
        print(f"  ❌ {name}" + (f" — {detail}" if detail else ""))


def post_with(front: str, body: str = "본문입니다.\n") -> Path:
    d = Path(tempfile.mkdtemp()) / "coin" / "2026-08-24"
    d.mkdir(parents=True)
    (d / "post.md").write_text(f"---\n{front}---\n{body}", encoding="utf-8")
    return d / "post.md"


print("\n── 글자 줄이기 ──")

check("짧으면 그대로 둔다", ig._shorten("코스피와 코스닥", 20) == "코스피와 코스닥")

# 예전에 "움직일 수 있습니다" 에서 "일 수 있습니다" 를 떼어 "움직" 만 남던 문제
got = ig._shorten("지수는 시장 전체의 평균이므로 내가 가진 종목과 다르게 움직일 수 있습니다", 34)
check("꼬리를 떼도 낱말이 깨지지 않는다", not got.endswith("움직"), got)

check("이모지는 지운다", "↔" not in ig._shorten("비트코인 숨 고르기 ↔️", 40))
check("시계 기호도 지운다", "⏱" not in ig._shorten("조급함이 만드는 실수 ⏱️", 40))

long_one = "한 주를 시작할 때는 코스피, 코스닥, 원·달러 환율 세 가지만 보셔도 됩니다"
short = ig._shorten(long_one, 34)
check("쉼표로 나열한 뜻을 쪼개지 않는다", "코스피" in short and "코스닥" in short, short)

print("\n── 원고가 지정한 문구 ──")

md = post_with(
    "title: '[주식완전기초]- 아무 제목'\n"
    "infographic:\n"
    "  kind: three\n"
    "  slug: my_slug\n"
    "  title: 월요일 아침에 볼 숫자 셋\n"
    "  points:\n"
    "    - 코스피와 코스닥 지수\n"
    "    - 달러 대비 원화 환율\n"
    "  footer: 숫자보다 방향을 보세요\n"
)
s = ig.analyze(md)
check("원고 문구를 그대로 쓴다", s.title == "월요일 아침에 볼 숫자 셋", s.title)
check("원고 지정으로 표시된다", s.authored is True)
check("항목이 그대로 들어간다", s.points == ["코스피와 코스닥 지수", "달러 대비 원화 환율"], str(s.points))
check("바닥 한 줄이 들어간다", s.footer == "숫자보다 방향을 보세요", s.footer)
check("slug 를 파일 이름에 쓴다", s.topic_slug == "my_slug", s.topic_slug)

s2 = ig.analyze(post_with("title: '[주식완전기초]- 자동으로 뽑을 제목입니다'\n"))
check("infographic 칸이 없으면 자동 초안", s2.authored is False)

print("\n── 잘못 적었을 때 ──")

try:
    ig.analyze(post_with("title: x\ninfographic:\n  kind: 없는유형\n  title: 제목\n  points: [가나다라]\n"))
    check("모르는 유형은 알려 준다", False, "오류가 나지 않았습니다")
except ValueError as e:
    check("모르는 유형은 알려 준다", "kind" in str(e), str(e))

try:
    ig.analyze(post_with("title: x\ninfographic:\n  kind: three\n  title: 제목만 있음\n"))
    check("항목이 비면 알려 준다", False, "오류가 나지 않았습니다")
except ValueError as e:
    check("항목이 비면 알려 준다", "points" in str(e), str(e))

try:
    ig.analyze(post_with("title: x\ninfographic:\n  kind: compare\n  title: 제목\n  left_items: [가나다]\n"))
    check("비교형에 한쪽만 있으면 알려 준다", False, "오류가 나지 않았습니다")
except ValueError as e:
    check("비교형에 한쪽만 있으면 알려 준다", "left_items" in str(e) or "right_items" in str(e), str(e))

print("\n── 그림 만들기 ──")

out = Path(tempfile.mkdtemp())
for kind in ig.DRAWERS:
    sp = ig.Spec(kind=kind, title="세 가지만 기억하세요",
                 points=["첫 번째 것입니다", "두 번째 것입니다", "세 번째 것입니다"],
                 footer="한 가지만 가져가세요", topic_slug=f"t_{kind}")
    if kind == "compare":
        sp.left_label, sp.right_label = "이쪽", "저쪽"
        sp.left_items = ["왼쪽 하나", "왼쪽 둘"]
        sp.right_items = ["오른쪽 하나", "오른쪽 둘"]
    path, probs = ig.build(sp, out)
    im = Image.open(path)
    check(f"{ig.KIND_KO[kind]} 규격 1200x1500", im.size == (ig.W, ig.H), str(im.size))
    check(f"{ig.KIND_KO[kind]} 검수 통과", not probs, "; ".join(probs))
    check(f"{ig.KIND_KO[kind]} RGB 로 저장", im.mode == "RGB", im.mode)

first = ig.save_jpeg(Image.new("RGB", (ig.W, ig.H), "white"), out, "dup")
second = ig.save_jpeg(Image.new("RGB", (ig.W, ig.H), "white"), out, "dup")
check("같은 이름이면 _01 을 붙인다", second.stem.endswith("_01"), second.name)
check("먼저 만든 파일을 덮어쓰지 않는다", first.exists() and first != second)

print("\n" + "─" * 58)
if bad:
    print(f"  {len(bad)}개 실패")
    for b in bad:
        print(f"    - {b}")
    sys.exit(1)
print(f"  ✅ {ok}개 전부 통과")
