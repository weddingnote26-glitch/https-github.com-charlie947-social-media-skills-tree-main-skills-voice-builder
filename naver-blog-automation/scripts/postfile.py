# -*- coding: utf-8 -*-
"""post.md 파일을 읽고 쓰는 도우미 — 앞머리 메타데이터와 본문을 나눕니다."""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import yaml

FRONT_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n?(.*)$", re.S)


class PostFile:
    def __init__(self, path: Path, front: dict, body: str):
        self.path = path
        self.front: dict = front
        self.body: str = body

    # ── 읽기/쓰기 ──────────────────────────────────────────
    @classmethod
    def load(cls, path: Path | str) -> "PostFile":
        text = Path(path).read_text(encoding="utf-8")
        m = FRONT_RE.match(text)
        if not m:
            return cls(Path(path), {}, text)
        front = yaml.safe_load(m.group(1)) or {}
        if not isinstance(front, dict):
            front = {}
        return cls(Path(path), front, m.group(2))

    def save(self) -> Path:
        front = yaml.safe_dump(self.front, allow_unicode=True,
                               sort_keys=False, width=100)
        text = f"---\n{front}---\n\n{self.body.lstrip()}"
        self.path.write_text(text, encoding="utf-8", newline="\n")
        return self.path

    # ── 본문 구획 ──────────────────────────────────────────
    def headings(self) -> list[str]:
        return re.findall(r"^##\s+(.+?)\s*$", self.body, re.M)

    def hashtags(self) -> list[str]:
        tags = self.front.get("hashtags")
        if isinstance(tags, list) and tags:
            return [str(t).lstrip("#") for t in tags]
        return [t.lstrip("#") for t in re.findall(r"(?<!\w)#([^\s#]+)", self.body)]

    def image_refs(self) -> list[str]:
        """본문의 [이미지:파일명] 표시를 모읍니다."""
        return re.findall(r"\[이미지:\s*([^\]]+?)\s*\]", self.body)

    def intro(self) -> str:
        """첫 번째 소제목 앞의 도입부."""
        head = self.body.split("\n## ", 1)[0]
        head = re.sub(r"\[이미지:[^\]]*\]", "", head)
        return head.strip()

    def prose(self) -> str:
        """
        문장 검사에 쓰는 본문 — 해시태그 줄, 이미지 표시,
        투자 유의 문구, 편집자 메모는 뺍니다.
        """
        text = self.body
        text = re.sub(r"\[이미지:[^\]]*\]", "", text)
        text = re.sub(r"^\s*#[^\s#].*$", "", text, flags=re.M)   # 해시태그 줄
        text = re.sub(r"^\s*>.*$", "", text, flags=re.M)          # 인용
        return text.strip()

    def get(self, key: str, default: Any = None) -> Any:
        return self.front.get(key, default)


def sync_metadata(pdir, post: "PostFile") -> dict:
    """
    post.md 앞머리의 내용을 metadata.yaml 로 옮겨 담습니다.
    (제목·태그·키워드·이미지·자료기준 — 발행 단계에서 쓰는 값들)
    """
    from pathlib import Path as _P
    import yaml as _yaml

    meta_path = _P(pdir) / "metadata.yaml"
    meta = {}
    if meta_path.exists():
        meta = _yaml.safe_load(meta_path.read_text(encoding="utf-8")) or {}

    if post.get("title"):
        meta["title"] = post.get("title")
    if post.get("title_candidates"):
        meta["title_candidates"] = list(post.get("title_candidates"))
    if post.get("keywords"):
        meta["keywords"] = list(post.get("keywords"))
    tags = post.hashtags()
    if tags:
        meta["hashtags"] = tags
    if post.get("category"):
        meta.setdefault("publish", {})["category"] = post.get("category")
    if post.get("data_asof"):
        meta.setdefault("sources", {})["data_asof"] = post.get("data_asof")

    meta_path.write_text(
        _yaml.safe_dump(meta, allow_unicode=True, sort_keys=False, width=100),
        encoding="utf-8", newline="\n",
    )
    return meta
