# -*- coding: utf-8 -*-
"""
검수 — 원고를 14가지 기준으로 자동 검사합니다.

  결과가 '막힘(block)' 인 항목이 하나라도 있으면 승인할 수 없습니다.
  '확인(warn)' 은 사람이 눈으로 보고 판단합니다.

실행:  python scripts/review.py [--week 2026-W36] [--post <게시물ID>]
"""
from __future__ import annotations

import argparse
import datetime as dt
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts import common as c            # noqa: E402
from scripts import textutil as t          # noqa: E402
from scripts.postfile import PostFile, sync_metadata   # noqa: E402
from scripts import factcheck as fcheck    # noqa: E402

BLOCK, WARN, PASS = "막힘", "확인", "통과"


@dataclass
class Finding:
    no: int
    label: str
    level: str = PASS
    detail: str = ""


@dataclass
class Report:
    pdir: Path
    post_id: str
    findings: list[Finding] = field(default_factory=list)

    def add(self, no: int, label: str, level: str = PASS, detail: str = "") -> None:
        self.findings.append(Finding(no, label, level, detail))

    @property
    def blocks(self) -> list[Finding]:
        return [f for f in self.findings if f.level == BLOCK]

    @property
    def warns(self) -> list[Finding]:
        return [f for f in self.findings if f.level == WARN]

    @property
    def passed(self) -> bool:
        return not self.blocks


# ──────────────────────────────────────────────────────────────
# 개별 검사
# ──────────────────────────────────────────────────────────────
def check_date_weekday(r: Report, post: PostFile, meta: dict) -> None:
    """1. 날짜와 요일이 맞는가"""
    date_str = str(post.get("publish_date") or meta.get("publish", {}).get("date", ""))
    stated = str(post.get("weekday") or "")
    try:
        d = dt.date.fromisoformat(date_str)
    except ValueError:
        r.add(1, "날짜와 요일 일치", BLOCK, f"발행일이 올바르지 않습니다: 「{date_str}」")
        return
    actual = c.weekday_ko(d)
    if stated and stated != actual:
        r.add(1, "날짜와 요일 일치", BLOCK,
              f"{date_str} 은 {actual}요일인데 원고에는 {stated}요일로 적혀 있습니다.")
        return
    # 본문에 적힌 요일도 확인합니다.
    for m in re.finditer(r"(\d{1,2})월\s*(\d{1,2})일\s*\(?([월화수목금토일])\)?", post.body):
        mm, dd, wd = int(m.group(1)), int(m.group(2)), m.group(3)
        try:
            body_date = dt.date(d.year, mm, dd)
        except ValueError:
            continue
        if c.weekday_ko(body_date) != wd:
            r.add(1, "날짜와 요일 일치", BLOCK,
                  f"본문 「{m.group(0)}」 — {mm}월 {dd}일은 "
                  f"{c.weekday_ko(body_date)}요일입니다.")
            return
    r.add(1, "날짜와 요일 일치", PASS, f"{date_str} ({actual})")


STALE_WORDS = ["오늘", "현재", "지금", "방금", "실시간"]


def check_stale_data(r: Report, post: PostFile) -> None:
    """2. 과거 자료를 최신처럼 표현했는가"""
    asof_raw = str(post.get("data_asof") or "")
    m = re.search(r"(\d{4}-\d{2}-\d{2})", asof_raw)
    if not m:
        r.add(2, "과거 자료를 최신처럼 표현", PASS, "자료 기준 시각 없음(정적인 글)")
        return
    asof = dt.date.fromisoformat(m.group(1))
    try:
        pub = dt.date.fromisoformat(str(post.get("publish_date")))
    except (ValueError, TypeError):
        r.add(2, "과거 자료를 최신처럼 표현", WARN, "발행일을 읽을 수 없어 비교하지 못했습니다.")
        return
    gap = (pub - asof).days
    if gap <= 1:
        r.add(2, "과거 자료를 최신처럼 표현", PASS, f"자료와 발행일 차이 {gap}일")
        return
    used = [w for w in STALE_WORDS if w in post.prose()]
    if used:
        r.add(2, "과거 자료를 최신처럼 표현", BLOCK,
              f"자료 기준일({asof})이 발행일({pub})보다 {gap}일 앞서는데 "
              f"본문에 「{', '.join(used)}」 같은 말을 썼습니다. "
              f"'{asof} 기준' 처럼 시점을 밝혀 주세요.")
    else:
        r.add(2, "과거 자료를 최신처럼 표현", WARN,
              f"자료가 발행일보다 {gap}일 앞섭니다. 발행 전에 다시 확인해 주세요.")


def check_numbers(r: Report, pdir: Path, settings: dict) -> None:
    """3. 숫자와 출처가 맞는가"""
    res = fcheck.check_post(pdir, settings)
    if res["ok"]:
        r.add(3, "숫자와 출처 일치", PASS, f"수치 {res['claims']}건 확인됨")
        return
    bits = [f"{u['line']}번째 줄 「{u['value']}」" for u in res["unbacked"][:5]]
    detail = "; ".join(bits + res["notes"][:3])
    level = BLOCK if res["unbacked"] else WARN
    r.add(3, "숫자와 출처 일치", level, detail or "출처 확인이 끝나지 않았습니다.")


# 제목 대조에서 뺄 흔한 말 (뜻을 담지 않는 낱말)
TITLE_STOPWORDS = {
    "무엇", "어디", "어떻게", "언제", "그리고", "하지만", "이것", "그것",
    "합니다", "입니다", "할까요", "있을까요", "인가요", "일까요", "됩니다",
    "어디부터", "여기", "저기", "정말", "너무", "가장", "조금",
}


def _stem_in(word: str, body: str) -> bool:
    """
    한국어는 낱말 뒤에 조사·어미가 붙습니다.
    (읽어야 / 읽는 / 읽기 → 줄기는 '읽')
    그래서 낱말 그대로가 아니라 앞부분(줄기)이 본문에 있는지를 봅니다.
    최소 2글자까지만 줄여서 지나치게 헐거워지지 않게 합니다.
    """
    for k in range(len(word), 1, -1):
        if word[:k] in body:
            return True
    return False


def check_title_body(r: Report, post: PostFile) -> None:
    """4. 제목과 본문 내용이 맞는가"""
    title = str(post.get("title") or "").strip()
    if not title:
        r.add(4, "제목과 본문 일치", BLOCK, "최종 제목이 비어 있습니다.")
        return
    cands = post.get("title_candidates") or []
    if len(cands) < 3:
        r.add(4, "제목과 본문 일치", WARN,
              f"제목 후보가 {len(cands)}개입니다. 3개를 만들어 주세요.")
        return
    key = [w for w in t.words(title) if len(w) >= 2 and w not in TITLE_STOPWORDS]
    if not key:
        r.add(4, "제목과 본문 일치", PASS, "제목이 짧아 대조를 건너뜁니다.")
        return
    body = post.prose()
    hit = [w for w in key if _stem_in(w, body)]
    missing = [w for w in key if w not in hit]
    ratio = len(hit) / len(key)
    if ratio < 0.5:
        # 한국어는 조사·어미가 붙어 형태가 달라지므로 이 대조는 참고용입니다.
        # 사람이 최종 판단하도록 '확인'으로만 알립니다.
        r.add(4, "제목과 본문 일치", WARN,
              f"제목의 낱말 「{', '.join(missing[:4])}」 이(가) 본문에서 잘 보이지 않습니다. "
              f"제목이 내용을 담고 있는지 눈으로 확인해 주세요.")
    else:
        r.add(4, "제목과 본문 일치", PASS,
              f"제목 낱말 {len(hit)}/{len(key)}개가 본문에 있음")


def check_tone(r: Report, post: PostFile, ch: dict, settings: dict) -> None:
    """5. 채널 문체가 맞는가 — 채널별 실측 기준으로 봅니다."""
    tg = ch.get("review_targets") or {}
    rv = settings.get("review") or {}

    def t_get(key, fallback):
        v = tg.get(key)
        return v if v is not None else rv.get(key, fallback)

    calibrated = int(tg.get("calibrated_from", 0)) > 0
    max_sent = int(t_get("max_sentence_chars", 90))
    min_c = int(t_get("min_chars", 1100))
    max_c = int(t_get("max_chars", 2200))
    intro_max = int(t_get("intro_max_chars", 250))
    h_min = int(t_get("headings_min", 3))
    h_max = int(t_get("headings_max", 6))
    long_ratio_limit = float(t_get("long_sentence_ratio", 0.15))

    prose = post.prose()
    sents = t.sentences(prose)
    if not sents:
        r.add(5, "채널 문체 일치", BLOCK, "본문이 비어 있습니다.")
        return

    body_chars = t.char_count(prose)
    heads = post.headings()
    intro_len = t.char_count(post.intro())
    long_ones = [s for s in sents if t.char_count(s) > max_sent]
    long_ratio = len(long_ones) / len(sents)
    avg = sum(t.char_count(s) for s in sents) // len(sents)

    length_problems, structure_problems = [], []

    if body_chars < min_c:
        length_problems.append(f"본문이 {body_chars}자로 짧습니다 (기준 {min_c}자 이상)")
    elif body_chars > max_c:
        length_problems.append(f"본문이 {body_chars}자로 깁니다 (기준 {max_c}자 이하)")

    if not (h_min <= len(heads) <= h_max):
        structure_problems.append(
            f"소제목이 {len(heads)}개입니다 (기준 {h_min}~{h_max}개)")

    if intro_len > intro_max:
        length_problems.append(f"도입부가 {intro_len}자입니다 (기준 {intro_max}자 이내)")

    if long_ratio > long_ratio_limit:
        msg = (f"{max_sent}자 넘는 문장이 {len(long_ones)}개"
               f"({long_ratio:.0%})입니다")
        if ch["key"] == "stock":
            msg += " — 50~70대 독자에게는 문장이 깁니다"
        length_problems.append(msg)

    problems = structure_problems + length_problems

    if problems:
        # 소제목 개수처럼 구조가 어긋난 것은 막습니다.
        # 글자 수는 표본을 측정하기 전이라면 막지 않고 알리기만 합니다.
        if structure_problems:
            level = BLOCK
        elif calibrated:
            level = BLOCK if body_chars < min_c else WARN
        else:
            level = WARN
            problems.append("(이 채널은 아직 실제 글을 측정하지 않아 임시 기준입니다)")
        r.add(5, "채널 문체 일치", level, " / ".join(problems))
    else:
        note = f"{body_chars}자 · 소제목 {len(heads)}개 · 도입부 {intro_len}자 · 평균 문장 {avg}자"
        if calibrated:
            note += f" (표본 {tg.get('calibrated_from')}편 기준)"
        r.add(5, "채널 문체 일치", PASS, note)


def check_cross_channel(r: Report, post: PostFile, others: list[PostFile],
                        settings: dict, guard: dict) -> None:
    """6. 두 채널 사이에 내용이 겹치는가"""
    limit = float((settings.get("review") or {}).get("max_cross_channel_similarity", 0.25))
    worst, worst_id = 0.0, ""
    for o in others:
        s = t.similarity(post.prose(), o.prose())
        if s > worst:
            worst, worst_id = s, str(o.get("post_id", ""))

    shared = guard.get("shared_keywords_warn") or []
    both = [k for k in shared
            if k in post.prose() and any(k in o.prose() for o in others)]

    if worst >= limit:
        r.add(6, "두 채널 사이 내용 중복", BLOCK,
              f"같은 날 다른 채널 글과 {worst:.0%} 닮았습니다 ({worst_id}). "
              f"소재나 예시를 바꿔 주세요.")
    elif both:
        r.add(6, "두 채널 사이 내용 중복", WARN,
              f"두 채널이 같은 소재를 다룹니다: 「{', '.join(both)}」. "
              f"설명 방식이 겹치지 않는지 확인해 주세요.")
    else:
        r.add(6, "두 채널 사이 내용 중복", PASS, f"가장 닮은 정도 {worst:.0%}")


def check_history_similarity(r: Report, post: PostFile,
                             history: list[PostFile], settings: dict) -> None:
    """7. 이전 게시물과 문장이 닮았는가"""
    limit = float((settings.get("review") or {}).get("max_similarity", 0.35))
    worst, worst_id, worst_run = 0.0, "", ""
    for h in history:
        s = t.similarity(post.prose(), h.prose())
        if s > worst:
            worst, worst_id = s, str(h.get("post_id", ""))
            worst_run = t.longest_common_run(post.prose(), h.prose())

    if worst >= limit:
        r.add(7, "이전 게시물과 문장 유사도", BLOCK,
              f"{worst_id} 와(과) {worst:.0%} 닮았습니다. "
              f"같은 부분: 「{worst_run[:40]}…」")
    elif len(worst_run) >= 30:
        r.add(7, "이전 게시물과 문장 유사도", WARN,
              f"{worst_id} 와(과) {len(worst_run)}자가 그대로 겹칩니다: "
              f"「{worst_run[:40]}…」")
    else:
        r.add(7, "이전 게시물과 문장 유사도", PASS,
              f"비교한 글 {len(history)}편 · 최대 {worst:.0%}")


def _is_prohibitive(text: str, pos: int, length: int, cfg: dict) -> bool:
    """
    걸린 표현이 '하지 말라'는 문장 안에 있는지 봅니다.

      "섣부른 몰빵 금지"                → 말리는 문장
      "풀매수하고 있으면 고통스럽습니다"  → 말리는 문장
      "지금 몰빵하세요"                 → 진짜 유도

    앞뒤 가까운 곳에 '금지', '마세요', '고통' 같은 말이 있으면
    말리는 문장으로 보고 넘어갑니다.
    """
    markers = cfg.get("markers") or []
    if not markers:
        return False
    after = int(cfg.get("window_after", 24))
    before = int(cfg.get("window_before", 12))
    # 걸린 표현 자체는 빼고 그 앞뒤만 봅니다.
    # (안 그러면 "손실 없는 투자" 의 '손실' 이 스스로를 면제해 버립니다)
    left = text[max(0, pos - before): pos]
    right = text[pos + length: pos + length + after]
    return any((m in left) or (m in right) for m in markers)


def _scan_groups(text: str, groups: list[dict], ch_key: str,
                 ids: set[str], banned: dict | None = None
                 ) -> list[tuple[str, str, str]]:
    """(그룹라벨, 심각도, 걸린표현) 목록"""
    ctx = (banned or {}).get("prohibitive_context") or {}
    hits = []
    for g in groups:
        if g["id"] not in ids:
            continue
        if ch_key not in (g.get("applies_to") or []):
            continue
        for pat in g.get("patterns", []):
            start = 0
            while True:
                pos = text.find(pat, start)
                if pos < 0:
                    break
                start = pos + 1
                # 말리는 문장이면 걸지 않습니다.
                if ctx and _is_prohibitive(text, pos, len(pat), ctx):
                    continue
                hits.append((g["label"], g["severity"], pat))
                break
    return hits


def check_profit_guarantee(r: Report, post: PostFile, ch_key: str,
                           banned: dict) -> None:
    """8. 투자 수익 보장 표현"""
    hits = _scan_groups(post.body, banned["groups"], ch_key, {"profit_guarantee"}, banned)
    if hits:
        r.add(8, "투자 수익 보장 표현", BLOCK,
              "쓰면 안 되는 표현: " + ", ".join(f"「{h[2]}」" for h in hits))
    else:
        r.add(8, "투자 수익 보장 표현", PASS, "없음")


def check_fear_and_solicit(r: Report, post: PostFile, ch_key: str,
                           banned: dict) -> None:
    """9. 과도한 공포·매수 유도 표현"""
    ids = {"trade_solicitation", "fear_mongering", "price_prediction",
           "slang_5070", "slang_coin", "rumor", "copy_signal"}
    hits = _scan_groups(post.body, banned["groups"], ch_key, ids, banned)
    blocked = [h for h in hits if h[1] == "block"]
    warned = [h for h in hits if h[1] == "warn"]
    if blocked:
        r.add(9, "과도한 공포·매수 유도 표현", BLOCK,
              "; ".join(f"{h[0]}: 「{h[2]}」" for h in blocked))
    elif warned:
        r.add(9, "과도한 공포·매수 유도 표현", WARN,
              "; ".join(f"{h[0]}: 「{h[2]}」" for h in warned))
    else:
        r.add(9, "과도한 공포·매수 유도 표현", PASS, "없음")


# 자주 틀리는 띄어쓰기·표기 (완전한 맞춤법 검사기가 아닙니다)
SPELL_HINTS = [
    (r"할수\s*있", "할 수 있"), (r"할수도", "할 수도"), (r"갈수\s*있", "갈 수 있"),
    (r"안됩니다", "안 됩니다"), (r"안되는", "안 되는"), (r"할것", "할 것"),
    (r"이라구요", "이라고요"), (r"됬", "됐"), (r"웬지", "왠지"),
    (r"몇일", "며칠"), (r"오랫만", "오랜만"), (r"어떻해", "어떡해"),
    (r"금새", "금세"), (r"바램", "바람"), (r"들어나", "드러나"),
    (r"틀리다\s*(?=값|수치|숫자)", "다르다"),
]


def check_spelling_and_length(r: Report, post: PostFile, settings: dict) -> None:
    """10. 맞춤법과 문장 길이"""
    body = post.prose()
    found = []
    for pat, fix in SPELL_HINTS:
        if re.search(pat, body):
            found.append(f"「{re.search(pat, body).group(0)}」 → 「{fix}」")

    double_space = len(re.findall(r"[가-힣]  +[가-힣]", body))
    if double_space:
        found.append(f"공백이 두 칸 이상인 곳 {double_space}군데")

    max_sent = int((settings.get("review") or {}).get("max_sentence_chars", 90))
    longest = max((t.char_count(s) for s in t.sentences(body)), default=0)

    if found:
        r.add(10, "맞춤법·문장 길이", WARN,
              "; ".join(found[:5]) + f" / 가장 긴 문장 {longest}자")
    else:
        r.add(10, "맞춤법·문장 길이", PASS,
              f"가장 긴 문장 {longest}자 (기준 {max_sent}자)")


def check_images(r: Report, post: PostFile, pdir: Path) -> None:
    """11. 이미지 누락"""
    declared = post.get("images") or []
    refs = post.image_refs()
    img_dir = pdir / "images"
    existing = {p.name for p in img_dir.glob("*") if p.is_file()} if img_dir.exists() else set()

    problems = []
    if not declared:
        problems.append("앞머리 images 목록이 비어 있습니다")
    if not refs:
        problems.append("본문에 [이미지:파일명] 표시가 없습니다")

    for d in declared:
        if not isinstance(d, dict):
            continue
        fn = str(d.get("file", ""))
        if fn and fn not in refs:
            problems.append(f"「{fn}」 이 본문에 표시되지 않았습니다")
        if not d.get("alt"):
            problems.append(f"「{fn}」 의 대체 텍스트가 없습니다")
        if fn and not re.fullmatch(r"[A-Za-z0-9._-]+", fn):
            problems.append(f"「{fn}」 파일명에 영문·숫자 외 글자가 있습니다")

    missing_files = [f for f in refs if f not in existing]
    if missing_files:
        problems.append(f"파일이 아직 없습니다: {', '.join(missing_files[:3])}")

    if problems:
        # 이미지 파일이 아직 없는 것만이면 '확인', 구조 문제면 '막힘'
        structural = [p for p in problems if "파일이 아직 없습니다" not in p]
        r.add(11, "이미지 누락", BLOCK if structural else WARN, " / ".join(problems[:4]))
    else:
        r.add(11, "이미지 누락", PASS, f"이미지 {len(refs)}개")


def check_hashtags(r: Report, post: PostFile, ch: dict, settings: dict) -> None:
    """12. 해시태그 과다"""
    tags = post.hashtags()
    # 채널별 값이 우선입니다. 실제 글을 재어 정한 값이기 때문입니다.
    # settings 의 max_hashtags 는 채널 설정이 없을 때만 쓰는 예비값입니다.
    lo = int(ch["hashtags"]["min"])
    hi = int(ch["hashtags"].get("max")
             or (settings.get("review") or {}).get("max_hashtags", 10))
    if len(tags) < lo:
        r.add(12, "해시태그 개수", BLOCK, f"{len(tags)}개입니다 (최소 {lo}개)")
    elif len(tags) > hi:
        r.add(12, "해시태그 개수", BLOCK, f"{len(tags)}개입니다 (최대 {hi}개)")
    elif len(set(tags)) != len(tags):
        dup = [x for x in set(tags) if tags.count(x) > 1]
        r.add(12, "해시태그 개수", WARN, f"같은 태그가 반복됩니다: {', '.join(dup)}")
    else:
        r.add(12, "해시태그 개수", PASS, f"{len(tags)}개")


def check_schedule_and_channel(r: Report, post: PostFile, meta: dict,
                               pdir: Path, ch: dict) -> None:
    """13. 예약 날짜와 채널이 맞는가"""
    problems = []
    folder_channel = pdir.parent.name
    folder_date = pdir.name

    if str(post.get("channel")) != folder_channel:
        problems.append(f"원고의 채널({post.get('channel')})이 폴더({folder_channel})와 다릅니다")
    if str(post.get("blog_id")) != ch["blog_id"]:
        problems.append(
            f"블로그 ID가 다릅니다: 원고 「{post.get('blog_id')}」 / "
            f"설정 「{ch['blog_id']}」 — 채널이 뒤바뀌었을 수 있습니다"
        )
    if str(post.get("publish_date")) != folder_date:
        problems.append(f"발행일({post.get('publish_date')})이 폴더 날짜({folder_date})와 다릅니다")

    meta_ch = (meta.get("channel") or {}).get("blog_id")
    if meta_ch and meta_ch != ch["blog_id"]:
        problems.append(f"metadata.yaml 의 블로그 ID가 다릅니다: 「{meta_ch}」")

    ptime = str(post.get("publish_time") or "")
    if not re.fullmatch(r"\d{2}:\d{2}", ptime):
        problems.append(f"예약 시간 형식이 잘못됐습니다: 「{ptime}」 (예: 07:00)")

    try:
        d = dt.date.fromisoformat(folder_date)
        if d.weekday() == 6:
            problems.append("일요일에 편성됐습니다 (월~토만 발행)")
    except ValueError:
        problems.append(f"폴더 날짜가 올바르지 않습니다: {folder_date}")

    if problems:
        r.add(13, "예약 날짜·채널 확인", BLOCK, " / ".join(problems))
    else:
        r.add(13, "예약 날짜·채널 확인", PASS,
              f"{ch['name']} ({ch['blog_id']}) · {folder_date} {ptime}")


def check_disclaimer(r: Report, post: PostFile, ch_key: str, banned: dict) -> None:
    """14. 필수 투자 유의 문구"""
    required = (banned.get("required_phrases") or {}).get(ch_key) or []
    body = post.body
    missing = []
    for req in required:
        if not any(p in body for p in req.get("any_of", [])):
            missing.append(req["label"])
    if missing:
        r.add(14, "투자 유의 문구", BLOCK, f"빠진 문구: {', '.join(missing)}")
    else:
        r.add(14, "투자 유의 문구", PASS, f"필수 문구 {len(required)}개 모두 있음")


def check_style_analyzed(r: Report, ch_key: str) -> None:
    """추가. 채널 양식 분석 여부"""
    st = c.style_status(ch_key)
    if st.get("status") == "analyzed":
        r.add(15, "채널 양식 분석", PASS, f"샘플 {st.get('sample_count', 0)}편 기준")
    else:
        r.add(15, "채널 양식 분석", WARN,
              f"아직 실제 블로그 양식을 분석하지 않았습니다 ({st.get('path')}). "
              f"샘플을 주면 분석해 반영할 수 있습니다.")


# ──────────────────────────────────────────────────────────────
def review_post(pdir: Path, settings: dict, banned: dict, guard: dict,
                same_day_others: list[PostFile], history: list[PostFile]) -> Report:
    post = PostFile.load(pdir / "post.md")
    # 원고 앞머리의 제목·태그를 metadata.yaml 로 먼저 옮겨 담습니다.
    meta = sync_metadata(pdir, post)
    ch_key = pdir.parent.name
    ch = c.get_channel(ch_key)
    r = Report(pdir, str(post.get("post_id") or meta.get("post_id") or pdir.name))

    check_date_weekday(r, post, meta)
    check_stale_data(r, post)
    check_numbers(r, pdir, settings)
    check_title_body(r, post)
    check_tone(r, post, ch, settings)
    check_cross_channel(r, post, same_day_others, settings, guard)
    check_history_similarity(r, post, history, settings)
    check_profit_guarantee(r, post, ch_key, banned)
    check_fear_and_solicit(r, post, ch_key, banned)
    check_spelling_and_length(r, post, settings)
    check_images(r, post, pdir)
    check_hashtags(r, post, ch, settings)
    check_schedule_and_channel(r, post, meta, pdir, ch)
    check_disclaimer(r, post, ch_key, banned)
    check_style_analyzed(r, ch_key)
    return r


def write_checklist(r: Report) -> Path:
    icon = {PASS: "✓ 통과", WARN: "△ 확인", BLOCK: "✗ 막힘"}
    lines = [
        "# 검수 결과",
        "",
        f"- 게시물 ID: {r.post_id}",
        f"- 검수 시각: {c.now_kst():%Y-%m-%d %H:%M} KST",
        f"- 결과: **{'통과' if r.passed else '수정 필요'}** "
        f"(막힘 {len(r.blocks)}건 · 확인 {len(r.warns)}건)",
        "",
        "## 자동 검사",
        "",
        "| # | 항목 | 결과 | 내용 |",
        "|---|---|---|---|",
    ]
    for f in sorted(r.findings, key=lambda x: x.no):
        detail = f.detail.replace("|", "/")
        lines.append(f"| {f.no} | {f.label} | {icon[f.level]} | {detail} |")

    lines += [
        "",
        "## 사람이 확인할 것",
        "",
        "- [ ] 제목이 내용을 정확히 담고 있는가",
        "- [ ] 본문의 수치가 sources.md 와 일치하는가",
        "- [ ] 이미지가 내용과 맞는가",
        "- [ ] 채널(블로그 주소)이 맞는가",
        "- [ ] 예약 날짜와 시간이 맞는가",
        "",
        "## 수정이 필요한 목록",
        "",
    ]
    if r.blocks:
        for f in r.blocks:
            lines.append(f"- **[{f.no}] {f.label}** — {f.detail}")
    else:
        lines.append("- (막는 문제 없음)")
    if r.warns:
        lines.append("")
        lines.append("### 확인만 하면 되는 것")
        for f in r.warns:
            lines.append(f"- [{f.no}] {f.label} — {f.detail}")
    lines.append("")
    return c.write_text(r.pdir / "checklist.md", "\n".join(lines))


def apply_status(r: Report) -> None:
    if not r.passed:
        return
    meta_path = r.pdir / "metadata.yaml"
    meta = c.read_yaml(meta_path, default={}) or {}
    meta.setdefault("review", {})
    meta["review"].update({
        "passed": True,
        "blocking_issues": 0,
        "warnings": len(r.warns),
        "checked_at": c.now_kst().strftime("%Y-%m-%d %H:%M:%S KST"),
    })
    if meta.get("status") == "fact_checked":
        meta["status"] = "reviewed"
        meta.setdefault("history", []).append({
            "status": "reviewed",
            "at": c.now_kst().strftime("%Y-%m-%d %H:%M:%S KST"),
            "by": "review.py",
            "note": f"자동 검수 통과 (확인 {len(r.warns)}건)",
        })
        post_path = r.pdir / "post.md"
        if post_path.exists():
            p = PostFile.load(post_path)
            p.front["status"] = "reviewed"
            p.save()
    c.write_yaml(meta_path, meta)


# ──────────────────────────────────────────────────────────────
def collect_history(current_week: Path, limit: int = 40) -> list[PostFile]:
    """이전 주차의 원고들을 모읍니다. (유사도 비교용)"""
    out: list[PostFile] = []
    for wdir in sorted((p for p in c.OUTPUT_DIR.iterdir()
                        if p.is_dir() and p != current_week), reverse=True):
        for pm in wdir.rglob("post.md"):
            out.append(PostFile.load(pm))
            if len(out) >= limit:
                return out
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="원고를 자동 검수합니다.")
    ap.add_argument("--week", help="주차 (예: 2026-W36)")
    ap.add_argument("--post", help="게시물 ID 하나만")
    args = ap.parse_args()

    try:
        settings = c.load_settings()
    except c.ConfigError as e:
        c.error(str(e))
        raise SystemExit(1)

    banned = c.read_yaml(c.CONFIG_DIR / "banned_phrases.yaml", default={}) or {}
    guard = (c.read_yaml(c.CONFIG_DIR / "topic_bank.yaml", default={}) or {}) \
        .get("cross_channel_guard", {})

    from scripts.generate_week import resolve_week
    wdir = resolve_week(args.week)

    c.header(f"{wdir.name} 검수")

    # 같은 날 다른 채널 글을 미리 모아 둡니다.
    by_date: dict[str, list[tuple[str, PostFile]]] = {}
    for pm in wdir.rglob("post.md"):
        by_date.setdefault(pm.parent.name, []).append(
            (pm.parent.parent.name, PostFile.load(pm)))

    history = collect_history(wdir)
    reports: list[Report] = []

    for pm in sorted(wdir.rglob("post.md")):
        pdir = pm.parent
        if args.post:
            meta = c.read_yaml(pdir / "metadata.yaml", default={}) or {}
            if meta.get("post_id") != args.post:
                continue
        others = [p for chk, p in by_date.get(pdir.name, [])
                  if chk != pdir.parent.name]
        r = review_post(pdir, settings, banned, guard, others, history)
        write_checklist(r)
        apply_status(r)
        reports.append(r)

        name = f"{pdir.parent.name}/{pdir.name}"
        if r.passed and not r.warns:
            c.ok(f"{name} — 모두 통과")
        elif r.passed:
            c.ok(f"{name} — 통과 (확인 {len(r.warns)}건)")
            for f in r.warns:
                c.say(f"      △ [{f.no}] {f.label}: {f.detail}")
        else:
            c.warn(f"{name} — 수정이 필요합니다 (막힘 {len(r.blocks)}건)")
            for f in r.blocks:
                c.say(f"      ✗ [{f.no}] {f.label}: {f.detail}")

    c.say()
    if not reports:
        c.warn("검수할 원고가 없습니다. 먼저 원고를 써 주세요.")
        return
    passed = sum(1 for r in reports if r.passed)
    c.ok(f"{len(reports)}편 중 {passed}편이 검수를 통과했습니다.")
    if passed < len(reports):
        c.say()
        c.say("  각 폴더의 checklist.md 에 고칠 목록이 있습니다.")
    else:
        c.say()
        c.say("  다음 단계:  python scripts/approve.py")
    c.get_logger().info(f"검수 {wdir.name}: {passed}/{len(reports)} 통과")


if __name__ == "__main__":
    main()
