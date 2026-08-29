"""담당자가 고른 사진 다루기 (지시서 §4 · §1-1).

**원본은 읽기만 합니다.** 옮기지도 고치지도 지우지도 않습니다 (§0-1 1번).
프로젝트 폴더의 ``source\\`` 로 **복사**해서 씁니다.
그래야 나중에 원본을 옮기거나 지워도 만들어 둔 영상이 깨지지 않습니다.

여기에는 화면 코드가 없습니다. 그래서 화면 없이도 시험할 수 있습니다.
"""

from __future__ import annotations

import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Sequence

# Kling 이 받아주는 입력 이미지 제약 (§2-1 공식)
KLING_FORMATS = (".jpg", ".jpeg", ".png")
KLING_MIN_PX = 300
KLING_MAX_MB = 50
KLING_ASPECT_MIN = 1 / 2.5
KLING_ASPECT_MAX = 2.5

# Ken Burns 는 우리가 직접 다루므로 조금 더 너그럽습니다.
KENBURNS_FORMATS = (".jpg", ".jpeg", ".png", ".webp", ".bmp")
KENBURNS_MIN_PX = 400
"""이보다 작으면 1080x1920 으로 키울 때 뭉개집니다."""


@dataclass(frozen=True)
class PhotoInfo:
    """사진 한 장에 대해 알아낸 것."""

    path: Path
    width: int = 0
    height: int = 0
    size_mb: float = 0.0
    ok: bool = False
    problem: str = ""
    """담당자에게 보여줄 한국어 한 문장 (§9). 비어 있으면 문제없음."""

    @property
    def name(self) -> str:
        return self.path.name

    @property
    def aspect(self) -> float:
        return (self.width / self.height) if self.height else 0.0

    @property
    def orientation(self) -> str:
        if not self.width or not self.height:
            return "?"
        if self.width > self.height * 1.1:
            return "가로"
        if self.height > self.width * 1.1:
            return "세로"
        return "정사각"


def inspect_photo(path: Path, *, for_kling: bool = False) -> PhotoInfo:
    """사진을 열어보고 쓸 수 있는지 봅니다.

    Args:
        for_kling: 참이면 Kling 입력 제약(§2-1)까지 봅니다.
            거짓이면 사진 움직이기(Ken Burns) 기준으로 봅니다.
    """
    p = Path(path)
    허용 = KLING_FORMATS if for_kling else KENBURNS_FORMATS

    if not p.is_file():
        return PhotoInfo(p, problem="파일을 찾지 못했습니다.")
    if p.suffix.lower() not in 허용:
        보기 = " · ".join(s.lstrip(".") for s in 허용)
        return PhotoInfo(p, problem=f"쓸 수 없는 형식입니다. {보기} 만 됩니다.")

    size_mb = p.stat().st_size / (1024 * 1024)
    try:
        from PIL import Image

        with Image.open(p) as im:
            w, h = im.size
            im.verify()
    except Exception:
        return PhotoInfo(p, size_mb=size_mb,
                         problem="사진을 열지 못했습니다. 다른 사진으로 해보세요.")

    최소 = KLING_MIN_PX if for_kling else KENBURNS_MIN_PX
    if w < 최소 or h < 최소:
        return PhotoInfo(p, w, h, size_mb,
                         problem=f"너무 작습니다. 가로·세로 모두 {최소}픽셀 이상이어야 합니다. "
                                 f"(지금 {w}×{h})")

    if for_kling:
        if size_mb > KLING_MAX_MB:
            return PhotoInfo(p, w, h, size_mb,
                             problem=f"너무 큽니다. {KLING_MAX_MB}MB 까지 됩니다. "
                                     f"(지금 {size_mb:.0f}MB)")
        a = w / h
        if not (KLING_ASPECT_MIN <= a <= KLING_ASPECT_MAX):
            return PhotoInfo(p, w, h, size_mb,
                             problem="사진이 너무 길쭉합니다. 다른 사진으로 해보세요.")

    return PhotoInfo(p, w, h, size_mb, ok=True)


class PhotoSet:
    """담당자가 고른 사진 묶음.

    **원본 경로만 들고 있습니다.** 영상을 만들 때 프로젝트 폴더로 복사합니다.
    고르는 동안에는 아무것도 쓰지 않습니다.
    """

    def __init__(self, paths: Sequence[Path] = ()) -> None:
        self._items: list[PhotoInfo] = []
        self.add(paths)

    # ── 담기 ──────────────────────────────────────────────
    def add(self, paths: Sequence[Path]) -> list[PhotoInfo]:
        """사진을 담습니다. 같은 파일은 두 번 담지 않습니다.

        Returns:
            이번에 새로 담은 것들 (문제가 있는 것도 담습니다 — 화면에 알려야 하니까요).
        """
        새로운: list[PhotoInfo] = []
        있는것 = {i.path.resolve() for i in self._items if i.path.exists()}
        for p in paths:
            path = Path(p)
            key = path.resolve() if path.exists() else path
            if key in 있는것:
                continue
            있는것.add(key)
            info = inspect_photo(path)
            self._items.append(info)
            새로운.append(info)
        return 새로운

    def remove(self, index: int) -> Optional[PhotoInfo]:
        """목록에서 뺍니다. **원본 파일은 그대로 둡니다.**"""
        if 0 <= index < len(self._items):
            return self._items.pop(index)
        return None

    def move(self, index: int, step: int) -> bool:
        """순서를 바꿉니다. 장면에 배정되는 차례가 달라집니다."""
        j = index + step
        if 0 <= index < len(self._items) and 0 <= j < len(self._items):
            self._items[index], self._items[j] = self._items[j], self._items[index]
            return True
        return False

    # ── 보기 ──────────────────────────────────────────────
    def __len__(self) -> int:
        return len(self._items)

    def __iter__(self):
        return iter(self._items)

    def __getitem__(self, i: int) -> PhotoInfo:
        return self._items[i]

    @property
    def usable(self) -> list[PhotoInfo]:
        """쓸 수 있는 것만."""
        return [i for i in self._items if i.ok]

    @property
    def problems(self) -> list[PhotoInfo]:
        return [i for i in self._items if not i.ok]

    def paths(self) -> tuple[Path, ...]:
        return tuple(i.path for i in self._items if i.ok)

    def index_of(self, path: Path) -> int:
        for n, i in enumerate(self._items):
            if str(i.path) == str(path):
                return n
        return -1

    # ── 복사 ──────────────────────────────────────────────
    def copy_into(self, dest_dir: Path) -> dict[Path, Path]:
        """프로젝트 폴더로 **복사**합니다. 원본은 건드리지 않습니다 (§0-1).

        같은 이름이 이미 있으면 덮지 않고 ``_2`` ``_3`` 을 붙입니다 (§0-1 3번).

        Returns:
            {원본 경로: 복사된 경로}
        """
        dest_dir = Path(dest_dir)
        dest_dir.mkdir(parents=True, exist_ok=True)
        옮긴것: dict[Path, Path] = {}

        for n, info in enumerate(self.usable, start=1):
            줄기 = f"{n:02d}_{info.path.stem}"
            대상 = dest_dir / f"{줄기}{info.path.suffix.lower()}"
            k = 2
            while 대상.exists():
                대상 = dest_dir / f"{줄기}_{k}{info.path.suffix.lower()}"
                k += 1
            shutil.copy2(info.path, 대상)      # copy2 — 원본은 남습니다
            옮긴것[info.path] = 대상
        return 옮긴것


# ─────────────────────────────────────────────────────────────
# 장면에 배정
# ─────────────────────────────────────────────────────────────


def auto_assign(scenes: Sequence, photos: PhotoSet) -> dict[int, Optional[Path]]:
    """사진을 「실제 사진 장면」 에 차례로 배정합니다.

    담당자가 화면에서 바꿀 수 있습니다. 이건 처음 놓는 자리일 뿐입니다.
    사진이 모자라면 남는 장면은 비워 둡니다 (그 장면은 만들 이미지가 필요합니다).
    """
    from app.contracts.models import RenderMode

    쓸것 = list(photos.usable)
    배정: dict[int, Optional[Path]] = {}
    다음 = 0
    for s in scenes:
        mode = getattr(s, "render_mode", None)
        if mode is RenderMode.KENBURNS or mode is RenderMode.STILL:
            배정[s.idx] = 쓸것[다음].path if 다음 < len(쓸것) else None
            다음 += 1
        else:
            배정[s.idx] = None
    return 배정


def assignment_problems(scenes: Sequence,
                        assigned: dict[int, Optional[Path]]) -> list[str]:
    """배정이 덜 된 곳을 한국어로 알려줍니다 (§9)."""
    from app.contracts.models import RenderMode

    빈곳 = [s.idx for s in scenes
            if getattr(s, "render_mode", None) is RenderMode.KENBURNS
            and not assigned.get(s.idx)]
    if not 빈곳:
        return []
    번호 = " · ".join(f"장면 {i}" for i in 빈곳)
    return [f"{번호} 에 넣을 사진이 없습니다. "
            "사진을 더 넣으시거나, 그 장면을 오락이 장면으로 바꿔주세요."]
