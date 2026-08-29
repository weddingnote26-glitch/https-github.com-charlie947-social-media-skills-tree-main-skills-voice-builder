"""사진 움직이기 시험 — Stage 6b.

완료 기준: **실제 사진 1장이 5초 영상으로 나옴.**
가짜가 아니라 **진짜 FFmpeg 로 진짜 파일을 만들어** 확인합니다.

    python tests/test_kenburns.py
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.contracts.models import (  # noqa: E402
    VIDEO_FPS,
    VIDEO_HEIGHT,
    VIDEO_WIDTH,
    VideoJob,
    VideoOutcome,
    VideoRequest,
)
from app.contracts.providers import VideoProvider  # noqa: E402
from app.core.ffmpeg import Ffmpeg, FfmpegFailed, find_ffmpeg  # noqa: E402
from app.providers.video_kenburns import (  # noqa: E402
    KenBurnsProvider,
    Move,
    build_filter,
    make_ai_notice_png,
    move_for_scene,
)

_ff: Ffmpeg | None = None


def ff() -> Ffmpeg:
    global _ff
    if _ff is None:
        _ff = Ffmpeg()
    return _ff


def _photo(size=(1600, 1200), name="음식.jpg") -> Path:
    """음식 사진처럼 생긴 시험용 사진."""
    from PIL import Image, ImageDraw

    img = Image.new("RGB", size, (238, 226, 200))
    d = ImageDraw.Draw(img)
    w, h = size
    d.ellipse([w * .25, h * .25, w * .75, h * .78], fill=(232, 206, 150),
              outline=(190, 160, 110), width=8)
    for i in range(0, w, max(w // 20, 10)):
        d.line([(i, 0), (i - w // 5, h)], fill=(214, 196, 160), width=3)
    p = Path(tempfile.mkdtemp()) / name
    img.save(p, quality=92)
    return p


# ═════════════════════════════════════════════════════════════
# FFmpeg 다루기
# ═════════════════════════════════════════════════════════════


def test_ffmpeg를_찾는다() -> None:
    assert find_ffmpeg().is_file()
    assert "ffmpeg version" in ff().version()


def test_명령을_문자열로_넘기면_막는다() -> None:
    """§3 — 경로에 공백이 있으면 문자열 연결은 거기서 깨집니다."""
    try:
        ff().run("-i a.jpg out.mp4")      # type: ignore[arg-type]
    except TypeError as e:
        assert "리스트" in str(e)
    else:  # pragma: no cover
        raise AssertionError("문자열을 그대로 받았습니다")


def test_경로에_공백이_있어도_된다() -> None:
    """「오락이 마스터 파일」 처럼 공백 있는 폴더에서도 돌아야 합니다."""
    src = _photo()
    공백폴더 = Path(tempfile.mkdtemp()) / "오락이 마스터 파일"
    공백폴더.mkdir(parents=True)
    사진 = 공백폴더 / "내 음식 사진.jpg"
    사진.write_bytes(src.read_bytes())

    dest = 공백폴더 / "결과 영상.mp4"
    req = VideoRequest(scene_idx=1, request_sec=1, prompt="",
                       source_photo=사진, external_task_id="공백")
    p = KenBurnsProvider(ffmpeg=ff())
    p.submit(req)
    made = p.render(req, dest)
    assert made.is_file() and made.stat().st_size > 0


def test_없는_필터를_있다고_말하지_않는다() -> None:
    """``ffmpeg -h filter=없는것`` 은 종료코드 0 을 냅니다. 출력을 봐야 합니다."""
    assert ff().has_filter("zoompan") is True
    assert ff().has_filter("이런필터는없다") is False


def test_ffprobe_없이_영상_정보를_읽는다() -> None:
    """동봉본에 ffprobe 가 없을 수 있습니다."""
    src = _photo(size=(800, 600))
    info = ff().probe(src)
    assert (info.width, info.height) == (800, 600)


# ═════════════════════════════════════════════════════════════
# 실제로 영상이 나오는가 (Stage 6b 완료 기준)
# ═════════════════════════════════════════════════════════════


def test_사진_한장이_5초_영상이_된다() -> None:
    """**Stage 6b 완료 기준입니다.**"""
    src = _photo()
    dest = Path(tempfile.mkdtemp()) / "장면.mp4"
    req = VideoRequest(scene_idx=2, request_sec=5, prompt="",
                       source_photo=src, external_task_id="s2")

    p = KenBurnsProvider(ffmpeg=ff())
    p.submit(req)
    made = p.render(req, dest)

    info = ff().probe(made)
    assert made.is_file() and made.stat().st_size > 10_000
    assert (info.width, info.height) == (VIDEO_WIDTH, VIDEO_HEIGHT), \
        f"{info.width}x{info.height} — 1080x1920 이어야 합니다"
    assert abs(info.duration_sec - 5.0) < 0.15, f"{info.duration_sec}초"
    assert abs(info.fps - VIDEO_FPS) < 0.5, f"{info.fps}fps"
    assert info.has_video and not info.has_audio, "소리는 나중에 붙입니다"


def test_가로사진도_세로사진도_9대16이_된다() -> None:
    """담당자가 어떤 사진을 넣을지 모릅니다. 여백이 생기면 안 됩니다."""
    for size in [(1600, 1200), (1200, 1600), (2000, 700), (900, 900)]:
        src = _photo(size=size, name=f"p{size[0]}x{size[1]}.jpg")
        dest = Path(tempfile.mkdtemp()) / "o.mp4"
        req = VideoRequest(scene_idx=1, request_sec=1, prompt="",
                           source_photo=src, external_task_id=f"a{size[0]}")
        p = KenBurnsProvider(ffmpeg=ff())
        p.submit(req)
        info = ff().probe(p.render(req, dest))
        assert (info.width, info.height) == (VIDEO_WIDTH, VIDEO_HEIGHT), \
            f"{size} 사진에서 {info.width}x{info.height} 가 나왔습니다"


def test_정말_움직인다() -> None:
    """가만히 있으면 Ken Burns 가 아닙니다. 프레임을 뽑아 비교합니다."""
    from PIL import Image

    src = _photo()
    out = Path(tempfile.mkdtemp())
    req = VideoRequest(scene_idx=2, request_sec=3, prompt="",
                       source_photo=src, external_task_id="move")
    p = KenBurnsProvider(ffmpeg=ff())
    p.submit(req)
    made = p.render(req, out / "m.mp4")

    프레임 = []
    for t in ("0", "2.8"):
        f = out / f"f{t}.png"
        ff().run(["-y", "-ss", t, "-i", str(made), "-frames:v", "1", str(f)])
        프레임.append(Image.open(f).convert("RGB"))

    다름 = sum(1 for a, b in zip(프레임[0].get_flattened_data()
                                 if hasattr(프레임[0], "get_flattened_data")
                                 else list(프레임[0].getdata()),
                                 list(프레임[1].getdata())) if a != b)
    비율 = 다름 / (VIDEO_WIDTH * VIDEO_HEIGHT) * 100
    assert 비율 > 5, f"처음과 끝이 {비율:.1f}% 만 다릅니다. 안 움직인 것 같습니다"


def test_장면마다_다르게_움직인다() -> None:
    """다섯 장면이 전부 같은 방향으로 움직이면 단조롭습니다."""
    움직임 = [move_for_scene(i) for i in range(1, 6)]
    assert len(set(움직임)) >= 3, f"너무 단조롭습니다: {[m.value for m in 움직임]}"
    for a, b in zip(움직임, 움직임[1:]):
        assert a is not b, "이웃한 장면이 같은 움직임입니다"


def test_필터에_필수_규격이_들어있다() -> None:
    f = build_filter(Move.ZOOM_IN, 150)
    assert "1080x1920" in f
    assert "fps=30" in f
    assert "yuv420p" in f, "이게 없으면 어떤 기기에서 재생이 안 됩니다"
    assert "force_original_aspect_ratio=increase" in f, "여백이 생기면 안 됩니다"


# ═════════════════════════════════════════════════════════════
# 계약 · 비용 · 오류
# ═════════════════════════════════════════════════════════════


def test_Kling과_같은_계약을_지킨다() -> None:
    assert isinstance(KenBurnsProvider(ffmpeg=ff()), VideoProvider)


def test_비용이_0원이다() -> None:
    """§1-1 — 한 편 비용의 대부분이 영상 생성입니다. 여기는 0원입니다."""
    req = VideoRequest(scene_idx=1, request_sec=5, prompt="")
    est = KenBurnsProvider(ffmpeg=ff()).estimate(req)
    assert est.krw == 0 and est.is_complete


def test_넣자마자_끝나_있다() -> None:
    """Kling 은 기다리지만 여기는 그 자리에서 끝납니다.
    그래도 확인 절차는 같아서 파이프라인이 안 갈라집니다."""
    src = _photo()
    p = KenBurnsProvider(ffmpeg=ff())
    req = VideoRequest(scene_idx=1, request_sec=1, prompt="",
                       source_photo=src, external_task_id="done")
    job = p.submit(req)
    p.render(req, Path(tempfile.mkdtemp()) / "o.mp4")
    states = p.poll([job])
    assert states[0].outcome is VideoOutcome.SUCCEEDED


def test_손잡이가_DB왕복을_견딘다() -> None:
    import dataclasses

    src = _photo()
    p = KenBurnsProvider(ffmpeg=ff())
    req = VideoRequest(scene_idx=3, request_sec=1, prompt="",
                       source_photo=src, external_task_id="orak-kb-s3")
    job = p.submit(req)
    되살림 = VideoJob(**dataclasses.asdict(job))
    assert 되살림 == job and 되살림.external_task_id == "orak-kb-s3"


def test_사진이_없으면_한국어로_알린다() -> None:
    """§9 — 개발자 오류를 담당자에게 보여주지 않습니다."""
    p = KenBurnsProvider(ffmpeg=ff())
    for req, 조각 in [
        (VideoRequest(scene_idx=1, request_sec=5, prompt=""), "사진이 없습니다"),
        (VideoRequest(scene_idx=1, request_sec=5, prompt="",
                      source_photo=Path("/없는/사진.jpg")), "찾지 못했습니다"),
    ]:
        try:
            p.submit(req)
        except FfmpegFailed as e:
            assert 조각 in e.user_message, e.user_message
            assert "Traceback" not in e.user_message
        else:  # pragma: no cover
            raise AssertionError("예외가 안 났습니다")


# ═════════════════════════════════════════════════════════════
# AI 생성 이미지 표기 (§1-1)
# ═════════════════════════════════════════════════════════════


def test_AI표기를_그린다() -> None:
    from PIL import Image

    png = make_ai_notice_png(Path(tempfile.mkdtemp()) / "n.png")
    im = Image.open(png)
    assert im.mode == "RGBA", "투명해야 얹을 수 있습니다"
    assert im.width > 60 and im.height > 20
    assert im.getpixel((0, 0))[3] < 255, "모서리는 비쳐야 합니다"


def test_AI표기가_영상에_얹힌다() -> None:
    """실제 매장 사진으로 오인시키면 안 됩니다 (§1-1)."""
    src = _photo()
    out = Path(tempfile.mkdtemp())
    png = make_ai_notice_png(out / "n.png")

    req = VideoRequest(scene_idx=1, request_sec=1, prompt="",
                       source_photo=src, external_task_id="ai")
    없이 = KenBurnsProvider(ffmpeg=ff())
    없이.submit(req)
    a = 없이.render(req, out / "없이.mp4")

    있이 = KenBurnsProvider(ffmpeg=ff(), ai_notice_png=png)
    있이.submit(req)
    b = 있이.render(req, out / "있이.mp4")

    assert a.read_bytes() != b.read_bytes(), "표기를 넣었는데 영상이 같습니다"
    assert ff().probe(b).width == VIDEO_WIDTH


def test_실제사진_장면에는_표기가_안_붙는다() -> None:
    """표기를 안 주면 아무것도 안 얹습니다."""
    p = KenBurnsProvider(ffmpeg=ff())
    assert p._ai_notice is None


if __name__ == "__main__":
    import traceback

    tests = [(n, f) for n, f in sorted(globals().items())
             if n.startswith("test_") and callable(f)]
    통과 = 실패 = 0
    for name, fn in tests:
        try:
            fn()
            print(f"  통과   {name}")
            통과 += 1
        except Exception:
            print(f"  실패 ✗ {name}")
            traceback.print_exc()
            실패 += 1
    print(f"\n{통과}개 통과, {실패}개 실패 (전체 {len(tests)}개)")
    sys.exit(1 if 실패 else 0)
