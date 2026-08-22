# -*- coding: utf-8 -*-
"""한국어 문장을 다루는 작은 도구들."""
from __future__ import annotations

import re

# 문장 끝: 마침표·물음표·느낌표 뒤 공백/줄바꿈
_SENT_END = re.compile(r"(?<=[.!?。])\s+|\n{2,}")
_HANGUL = re.compile(r"[가-힣]{2,}")
_WS = re.compile(r"\s+")


def sentences(text: str) -> list[str]:
    """본문을 문장 단위로 나눕니다. 목록 항목(-)도 한 문장으로 봅니다."""
    out: list[str] = []
    for block in text.split("\n"):
        block = block.strip()
        if not block:
            continue
        if block.startswith("#"):        # 소제목은 문장 길이 검사에서 제외
            continue
        block = re.sub(r"^[-*•]\s*", "", block)
        for s in _SENT_END.split(block):
            s = s.strip()
            if s:
                out.append(s)
    return out


def words(text: str) -> list[str]:
    """의미 있는 한글 낱말(2글자 이상)."""
    return _HANGUL.findall(text)


def normalize(text: str) -> str:
    """유사도 비교용 — 공백·기호를 없애고 한글과 숫자만 남깁니다."""
    text = re.sub(r"[^\w가-힣]", "", text)
    return _WS.sub("", text)


def ngrams(text: str, n: int = 4) -> set[str]:
    t = normalize(text)
    if len(t) < n:
        return {t} if t else set()
    return {t[i:i + n] for i in range(len(t) - n + 1)}


def similarity(a: str, b: str, n: int = 4) -> float:
    """
    두 글의 닮은 정도를 0~1 로 돌려줍니다. (자카드 유사도)
    문장을 그대로 베꼈는지 잡아내는 용도입니다.
    """
    A, B = ngrams(a, n), ngrams(b, n)
    if not A or not B:
        return 0.0
    return len(A & B) / len(A | B)


def longest_common_run(a: str, b: str) -> str:
    """두 글에서 똑같이 이어지는 가장 긴 부분. 복제 확인용."""
    import difflib
    A, B = normalize(a), normalize(b)
    if not A or not B:
        return ""
    m = difflib.SequenceMatcher(None, A, B, autojunk=False).find_longest_match(
        0, len(A), 0, len(B))
    return A[m.a:m.a + m.size]


def char_count(text: str) -> int:
    """공백을 뺀 글자 수."""
    return len(re.sub(r"\s", "", text))
