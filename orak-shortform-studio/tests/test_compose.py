"""최종 합성 시험 — Stage 9.

완료 기준: **장면들이 이어붙고, 자막이 구워지고, BGM 이 말소리보다
18dB 작게 깔린 세로 영상 한 편이 진짜로 나온다.**

가짜가 아니라 **진짜 FFmpeg 로 진짜 파일을 만들어** 확인합니다.

    python tests/test_compose.py
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.contracts.errors import PlanRejected  # noqa: E402
from app.contracts.models import (  # noqa: E402
    MAX_TOTAL_SEC,
    RenderMode,
    VIDEO_FPS,
    VIDEO_HEIGHT,
    VIDEO_WIDTH,
    Scene,
)
from app.core.ffmpeg import Ffmpeg  # noqa: E402
from app.media.compose import (  # noqa: E402
    BGM_GAIN_DB,
    GAIN_LIMIT_DB,
    VOICE_TARGET_LUFS,
    Compositor,
    Cut,
    _bgm_chain,
    _subtitle_chain,
    _video_chain,
    _voice_chain,
    cuts_from_scenes,
    find_bgm,
    gain_to_reach,
    measure_lufs,
    validate_length,
)

_ff: Ffmpeg | None = None


def ff() -> Ffmpeg:
    global _ff
    if _ff is None:
        _ff = Ffmpeg()
    return _ff


def _tmp() -> Path:
    return Path(tempfile.mkdtemp())


def _clip(dest: Path, sec: float, color: str = "0x8B4513",
          size: str = "640x360") -> Path:
    """장면 영상 흉내. **일부러 세로가 아닙니다** — 규격 맞추기까지 봅니다."""
    ff().run(["-y", "-loglevel", "error", "-f", "lavfi",
              "-i", f"color=c={color}:s={size}:d={sec}:r=25",
              "-c:v", "libx264", "-pix_fmt", "yuv420p", "-t", str(sec), str(dest)])
    return dest


def _tone(dest: Path, sec: float, db: float = -20.0, hz: int = 300,
          channels: int = 1) -> Path:
    """말소리·BGM 흉내. 기본이 **모노** 입니다 — AI 음성이 거의 다 모노입니다."""
    ff().run(["-y", "-loglevel", "error", "-f", "lavfi",
              "-i", f"sine=frequency={hz}:duration={sec}",
              "-af", f"volume={db}dB", "-ar", "44100",
              "-ac", str(channels), str(dest)])
    return dest


def _ass(dest: Path) -> Path:
    dest.write_text(
        "[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\n\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, Alignment, Encoding\n"
        "Style: body,Sans,72,&H00FFFFFF,5,1\n\n"
        "[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
        "Dialogue: 0,0:00:00.00,0:00:02.00,body,,0,0,0,,유료광고 포함\n",
        encoding="utf-8")
    return dest


def _세토막(d: Path) -> list[Cut]:
    return [Cut(source=_clip(d / f"s{i}.mp4", sec), use_sec=sec, scene_idx=i)
            for i, sec in ((1, 3.0), (2, 4.0), (3, 5.0))]


# ── 길이 검사 (§8: 30초 절대 초과 금지, 자동으로 안 자름) ────────────


def test_30초를_넘으면_합성을_시작하지_않는다() -> None:
    d = _tmp()
    cuts = [Cut(source=_clip(d / "a.mp4", 2), use_sec=12.0, scene_idx=1),
            Cut(source=_clip(d / "b.mp4", 2), use_sec=12.0, scene_idx=2),
            Cut(source=_clip(d / "c.mp4", 2), use_sec=9.0, scene_idx=3)]
    dest = d / "완성.mp4"
    try:
        Compositor(ff()).compose(cuts=cuts, dest=dest)
    except PlanRejected as e:
        assert "33" in e.user_message, e.user_message
        assert e.hints, "무엇을 줄여야 하는지 알려주지 않았습니다"
        assert any("장면 1" in h or "장면 2" in h for h in e.hints), e.hints
        assert any("3초" in h for h in e.hints), e.hints
    else:
        raise AssertionError("30초를 넘겼는데 그냥 만들었습니다")
    assert not dest.exists(), "거절해 놓고 파일을 만들었습니다"


def test_길이가_넘쳐도_알아서_자르지_않는다() -> None:
    """§8: 어느 장면을 줄일지는 **담당자가** 정합니다."""
    d = _tmp()
    cuts = [Cut(source=_clip(d / "a.mp4", 2), use_sec=31.0, scene_idx=1)]
    try:
        validate_length(cuts)
    except PlanRejected:
        pass
    else:
        raise AssertionError("31초를 통과시켰습니다")
    assert cuts[0].use_sec == 31.0, "사용자 값을 몰래 고쳤습니다"


def test_딱_30초는_통과한다() -> None:
    d = _tmp()
    cuts = [Cut(source=_clip(d / "a.mp4", 2), use_sec=MAX_TOTAL_SEC, scene_idx=1)]
    assert validate_length(cuts) == MAX_TOTAL_SEC


def test_장면이_없거나_0초거나_파일이_없으면_거절한다() -> None:
    d = _tmp()
    for cuts, 왜 in (
        ([], "빈 목록"),
        ([Cut(source=_clip(d / "a.mp4", 2), use_sec=0.0, scene_idx=1)], "0초"),
        ([Cut(source=d / "없는파일.mp4", use_sec=3.0, scene_idx=2)], "없는 파일"),
    ):
        try:
            validate_length(cuts)
        except PlanRejected as e:
            assert e.hints, f"{왜}: 어떻게 고치는지 안 알려줬습니다"
        else:
            raise AssertionError(f"{왜} 인데 통과시켰습니다")


# ── 장면 → 토막 ──────────────────────────────────────────────


def test_영상이_없는_장면은_빠진다() -> None:
    def 장면(idx, 시작, 끝, 영상=None):
        return Scene(idx=idx, start_sec=시작, end_sec=끝,
                     render_mode=RenderMode.KENBURNS,
                     narration="맛있습니다", screen_text="맛있다",
                     video_path=영상)

    scenes = [장면(1, 0, 3, Path("a.mp4")), 장면(2, 3, 7),
              장면(3, 7, 12, Path("c.mp4"))]
    cuts = cuts_from_scenes(scenes)
    assert [c.scene_idx for c in cuts] == [1, 3]
    assert [c.use_sec for c in cuts] == [3.0, 5.0], "장면 길이를 잘못 읽었습니다"


def test_Kling_5초를_받아도_3초만_쓴다() -> None:
    """§2-1: 만든 길이와 쓰는 길이는 다릅니다."""
    d = _tmp()
    원본 = _clip(d / "kling.mp4", 5.0)
    cut = Cut(source=원본, use_sec=3.0, scene_idx=1)
    dest = Compositor(ff()).compose(cuts=[cut], dest=d / "완성.mp4")
    assert abs(ff().probe(dest).duration_sec - 3.0) < 0.2, "3초만 써야 합니다"
    assert abs(ff().probe(원본).duration_sec - 5.0) < 0.2, "원본을 건드렸습니다"


# ── BGM 고르기 ───────────────────────────────────────────────


def test_BGM_폴더가_비었으면_없이_만든다() -> None:
    """§8: 음원은 **동봉하지 않습니다.** 없어도 영상은 나와야 합니다."""
    d = _tmp()
    (d / "bgm").mkdir()
    (d / "bgm" / "여기에_넣어주세요.txt").write_text("설명", encoding="utf-8")
    assert find_bgm(d / "bgm") is None, "안내문을 음원으로 착각했습니다"
    assert find_bgm(d / "없는폴더") is None

    cuts = _세토막(d)
    dest = Compositor(ff()).compose(cuts=cuts, dest=d / "완성.mp4",
                                    bgm=find_bgm(d / "bgm"))
    assert ff().probe(dest).has_audio, "BGM 이 없다고 소리 트랙까지 빠졌습니다"


def test_BGM_을_찾는다() -> None:
    d = _tmp()
    (d / "bgm").mkdir()
    _tone(d / "bgm" / "노래.mp3", 2.0)
    (d / "bgm" / "메모.txt").write_text("x", encoding="utf-8")
    assert find_bgm(d / "bgm").name == "노래.mp3"


# ── 소리 크기 재기 ───────────────────────────────────────────


def test_소리_크기를_잰다() -> None:
    d = _tmp()
    큰것 = measure_lufs(_tone(d / "큰.wav", 3.0, db=-6.0), ff())
    작은것 = measure_lufs(_tone(d / "작은.wav", 3.0, db=-26.0), ff())
    assert 큰것 is not None and 작은것 is not None
    assert abs((큰것 - 작은것) - 20.0) < 1.0, f"20dB 차이여야 하는데 {큰것 - 작은것:.1f}"


def test_무음은_못_잰_것으로_친다() -> None:
    """무음을 억지로 키우면 잡음만 커집니다."""
    d = _tmp()
    ff().run(["-y", "-loglevel", "error", "-f", "lavfi",
              "-i", "anullsrc=r=44100:cl=stereo", "-t", "2", str(d / "무음.wav")])
    assert measure_lufs(d / "무음.wav", ff()) is None


def test_모노_말소리도_같은_크기로_맞춰진다() -> None:
    """**최대값이 아니라 LUFS 로 재는 이유입니다.**

    FFmpeg 는 모노를 스테레오로 펼칠 때 좌우로 나눠 담아 **최대값이 3dB**
    내려갑니다. 최대값으로 맞추면 모노 파일만 3dB 작게 깔리는데,
    AI 음성은 거의 다 모노라 말소리가 계속 작아집니다.
    LUFS 는 좌우를 합쳐 보므로 펼치든 말든 같습니다.
    """
    import re as _re
    d = _tmp()

    def 최대값(p: Path, 펼치기: bool) -> float:
        af = ("aformat=channel_layouts=stereo,volumedetect" if 펼치기
              else "volumedetect")
        글 = ff().run(["-nostats", "-i", str(p), "-af", af, "-f", "null", "-"])
        return float(_re.findall(r"max_volume:\s*(-?[\d.]+) dB", 글)[-1])

    모노 = _tone(d / "모노.wav", 3.0, db=-20.0, channels=1)
    assert 최대값(모노, False) - 최대값(모노, True) > 2.0, (
        "펼칠 때 3dB 가 줄어드는 현상이 사라졌습니다 — 이 시험을 다시 보세요")

    # LUFS 는 그대로여야 합니다.
    글 = ff().run(["-nostats", "-i", str(모노), "-af", "ebur128", "-f", "null", "-"])
    그냥 = float(_re.findall(r"I:\s*(-?[\d.]+)\s*LUFS", 글)[-1])
    assert abs(measure_lufs(모노, ff()) - 그냥) < 0.5, (
        "LUFS 가 채널 수에 흔들립니다")

    # 그래서 모노 말소리도 스테레오와 같은 크기로 나와야 합니다.
    잰것 = []
    for 이름, ch in (("모노", 1), ("스테레오", 2)):
        cuts = [Cut(source=c.source, use_sec=c.use_sec, scene_idx=c.scene_idx,
                    voice=_tone(d / f"{이름}{c.scene_idx}.wav", c.use_sec,
                                db=-20.0, channels=ch))
                for c in _세토막(d)]
        dest = Compositor(ff()).compose(cuts=cuts, dest=d / f"{이름}.mp4")
        잰것.append(measure_lufs(dest, ff()))
    assert abs(잰것[0] - 잰것[1]) < 1.0, (
        f"모노 {잰것[0]:.1f} / 스테레오 {잰것[1]:.1f} LUFS — "
        "모노 말소리만 작게 나옵니다")


def test_올리는_폭에_한계가_있다() -> None:
    assert gain_to_reach(None, -16.0) == 0.0, "못 쟀으면 건드리지 말아야 합니다"
    assert gain_to_reach(-20.0, -16.0) == 4.0
    assert gain_to_reach(-10.0, -16.0) == -6.0
    assert gain_to_reach(-99.0, -16.0) == GAIN_LIMIT_DB, "한없이 키우면 잡음이 커집니다"
    assert gain_to_reach(99.0, -16.0) == -GAIN_LIMIT_DB


# ── 필터 만들기 ──────────────────────────────────────────────


def test_붙이기_전에_규격을_맞춘다() -> None:
    d = _tmp()
    parts, label = _video_chain(_세토막(d))
    붙인것 = ";".join(parts)
    assert f"scale={VIDEO_WIDTH}:{VIDEO_HEIGHT}" in 붙인것
    assert f"crop={VIDEO_WIDTH}:{VIDEO_HEIGHT}" in 붙인것
    assert f"fps={VIDEO_FPS}" in 붙인것
    assert "setsar=1" in 붙인것, "화소비가 다르면 이어붙이기가 깨집니다"
    assert "concat=n=3:v=1:a=0" in 붙인것
    assert label == "[vcat]"


def test_말소리가_없는_장면은_조용하게_채운다() -> None:
    d = _tmp()
    parts, label, _ = _voice_chain(_세토막(d), first_input=3)
    붙인것 = ";".join(parts)
    assert 붙인것.count("anullsrc") == 3
    assert "concat=n=3:v=0:a=1" in 붙인것
    assert label == "[avoice]"


def test_장면마다_말소리_크기를_맞춘다() -> None:
    d = _tmp()
    cuts = [Cut(source=c.source, use_sec=c.use_sec, scene_idx=c.scene_idx,
                voice=_tone(d / f"v{c.scene_idx}.wav", c.use_sec))
            for c in _세토막(d)]
    parts, _, 다음 = _voice_chain(cuts, first_input=3, gains={0: 6.0, 1: 0.0, 2: -4.0})
    붙인것 = ";".join(parts)
    assert "volume=6.00dB" in 붙인것
    assert "volume=-4.00dB" in 붙인것
    assert "volume=0.00dB" not in 붙인것, "0dB 이면 굳이 거치지 않습니다"
    assert 다음 == 6, "말소리 파일 3개가 입력으로 안 잡혔습니다"


def test_BGM_은_길면_자르고_짧으면_반복하고_양끝을_흐린다() -> None:
    parts, label = _bgm_chain(3, total=20.0, gain_db=-11.6)
    붙인것 = ";".join(parts)
    assert "aloop=loop=-1" in 붙인것, "짧은 음원이 중간에 끊깁니다"
    assert "atrim=0:20.000" in 붙인것, "영상보다 길게 깔립니다"
    assert "volume=-11.6dB" in 붙인것
    assert "afade=t=in:st=0" in 붙인것 and "afade=t=out" in 붙인것
    assert label == "[abgm]"


def test_자막_경로에_특수문자가_있어도_안_깨진다() -> None:
    parts, label = _subtitle_chain("[vcat]", Path(r"C:\작업\자막's.ass"), Path("C:/폰트"))
    붙인것 = parts[0]
    assert r"\:" in 붙인것, "윈도우 드라이브 문자를 안 감쌌습니다"
    assert r"\'" in 붙인것, "따옴표를 안 감쌌습니다"
    assert "\\" not in 붙인것.replace(r"\:", "").replace(r"\'", ""), "역슬래시가 남았습니다"
    assert "fontsdir=" in 붙인것
    assert label == "[vout]"


# ── 진짜로 한 편 만들기 ──────────────────────────────────────


def test_완성본_규격이_맞는다() -> None:
    """§8: 1080x1920 · 30fps · 소리 있음."""
    d = _tmp()
    cuts = _세토막(d)
    dest = Compositor(ff()).compose(
        cuts=cuts, dest=d / "완성.mp4", subtitle_ass=_ass(d / "자막.ass"),
        bgm=_tone(d / "노래.mp3", 4.0))
    m = ff().probe(dest)
    assert (m.width, m.height) == (VIDEO_WIDTH, VIDEO_HEIGHT), f"{m.width}x{m.height}"
    assert abs(m.fps - VIDEO_FPS) < 0.5, m.fps
    assert m.has_audio, "소리 트랙이 없습니다"
    assert abs(m.duration_sec - 12.0) < 0.3, m.duration_sec
    assert dest.stat().st_size > 0


def test_장면들이_실제로_이어붙는다() -> None:
    """색이 다른 세 토막을 넣고, 완성본에서 그 색이 차례로 나오는지 봅니다."""
    d = _tmp()
    색 = ("0xB03A2E", "0x1E8449", "0x2471A3")
    cuts = [Cut(source=_clip(d / f"s{i}.mp4", 2.0, color=c), use_sec=2.0, scene_idx=i)
            for i, c in enumerate(색, 1)]
    dest = Compositor(ff()).compose(cuts=cuts, dest=d / "완성.mp4")

    from PIL import Image
    본것 = []
    for 초 in (1.0, 3.0, 5.0):
        png = d / f"f{초}.png"
        ff().run(["-y", "-loglevel", "error", "-ss", str(초), "-i", str(dest),
                  "-frames:v", "1", str(png)])
        본것.append(Image.open(png).convert("RGB").resize((1, 1)).getpixel((0, 0)))
    assert 본것[0][0] > 본것[0][1] and 본것[0][0] > 본것[0][2], f"장면1이 빨강이 아님 {본것[0]}"
    assert 본것[1][1] > 본것[1][0] and 본것[1][1] > 본것[1][2], f"장면2가 초록이 아님 {본것[1]}"
    assert 본것[2][2] > 본것[2][0] and 본것[2][2] > 본것[2][1], f"장면3이 파랑이 아님 {본것[2]}"


def test_자막이_같은_판에서_구워진다() -> None:
    """§7: 자막은 맨 마지막에, 다시 인코딩하지 않고 한 번에 굽습니다."""
    d = _tmp()
    cuts = _세토막(d)
    없이 = Compositor(ff()).compose(cuts=cuts, dest=d / "없이.mp4")
    있이 = Compositor(ff()).compose(cuts=cuts, dest=d / "있이.mp4",
                                   subtitle_ass=_ass(d / "자막.ass"))
    assert 없이.read_bytes() != 있이.read_bytes(), "자막을 넣었는데 영상이 같습니다"


# ── 소리 균형 (§8 의 핵심) ───────────────────────────────────


def test_BGM_이_말소리보다_18dB_작게_깔린다() -> None:
    """§8 이 말하는 건 「파일을 18dB 줄여라」 가 아니라 **「말소리보다 18dB 아래」** 입니다.

    그래서 넣은 음원이 크든 작든 결과가 같아야 합니다.
    """
    d = _tmp()
    cuts = _세토막(d)
    목표 = VOICE_TARGET_LUFS + BGM_GAIN_DB
    for 이름, db in (("큰음원", -6.0), ("작은음원", -30.0)):
        dest = Compositor(ff()).compose(
            cuts=cuts, dest=d / f"{이름}.mp4",
            bgm=_tone(d / f"{이름}.mp3", 4.0, db=db, hz=180))
        잰것 = measure_lufs(dest, ff())
        assert 잰것 is not None, f"{이름}: 소리가 안 들어갔습니다"
        assert abs(잰것 - 목표) < 2.0, (
            f"{이름}: {잰것:.1f} LUFS 인데 {목표:.1f} 쯤이어야 합니다 — "
            "음원 크기를 재지 않고 그냥 줄이고 있습니다")


def test_amix_가_소리를_절반으로_나누지_않는다() -> None:
    """``amix`` 는 **기본값이 입력 개수로 나누기** 입니다 (normalize=1).

    그대로 두면 말소리와 BGM 이 나란히 6dB 씩 작아져서,
    BGM 이 -18dB 가 아니라 -24dB 로 깔리고 말소리도 먹먹해집니다.
    """
    d = _tmp()
    cuts = [Cut(source=c.source, use_sec=c.use_sec, scene_idx=c.scene_idx,
                voice=_tone(d / f"v{c.scene_idx}.wav", c.use_sec, db=-20.0))
            for c in _세토막(d)]
    말소리만 = Compositor(ff()).compose(cuts=cuts, dest=d / "말소리만.mp4")
    같이 = Compositor(ff()).compose(cuts=cuts, dest=d / "같이.mp4",
                                   bgm=_tone(d / "노래.mp3", 4.0, hz=180))
    a, b = measure_lufs(말소리만, ff()), measure_lufs(같이, ff())
    assert a is not None and b is not None
    assert abs(b - a) < 1.5, (
        f"BGM 을 깔았더니 말소리가 {a:.1f} → {b:.1f} LUFS 로 바뀌었습니다 — "
        "amix 가 입력 개수로 나누고 있습니다 (normalize=0 이 필요합니다)")


def test_장면마다_말소리_크기가_고르게_나온다() -> None:
    """AI 음성은 파일마다 크기가 들쭉날쭉합니다. 그대로 두면 안 들리는 장면이 생깁니다."""
    d = _tmp()
    cuts = [Cut(source=c.source, use_sec=c.use_sec, scene_idx=c.scene_idx,
                voice=_tone(d / f"v{c.scene_idx}.wav", c.use_sec,
                            db=[0.0, -8.0, -4.0][i]))
            for i, c in enumerate(_세토막(d))]
    dest = Compositor(ff()).compose(cuts=cuts, dest=d / "완성.mp4")

    시작 = 0.0
    잰것 = []
    for c in cuts:
        조각 = d / f"조각{c.scene_idx}.wav"
        ff().run(["-y", "-loglevel", "error", "-i", str(dest), "-vn",
                  "-af", f"atrim={시작 + 0.3}:{시작 + c.use_sec - 0.3},"
                         f"asetpts=PTS-STARTPTS", str(조각)])
        잰것.append(measure_lufs(조각, ff()))
        시작 += c.use_sec
    assert all(v is not None for v in 잰것), 잰것
    assert max(잰것) - min(잰것) < 3.0, (
        f"장면마다 {max(잰것) - min(잰것):.1f}dB 씩 차이가 납니다: "
        f"{[round(v, 1) for v in 잰것]}")
    assert abs(sum(잰것) / len(잰것) - VOICE_TARGET_LUFS) < 2.0, 잰것


# ── 안전 (§0-1, 분리규칙 §3-3) ───────────────────────────────


def test_파일을_지우는_코드가_없다() -> None:
    글 = Path(__file__).resolve().parent.parent / "app" / "media" / "compose.py"
    본문 = 글.read_text(encoding="utf-8")
    for 금지 in ("rmtree", "os.remove", "unlink", "rm -rf", "shutil.move"):
        assert 금지 not in 본문, f"{금지} 가 들어 있습니다"


def test_원본_장면_영상을_건드리지_않는다() -> None:
    d = _tmp()
    cuts = _세토막(d)
    전 = {c.source: c.source.read_bytes() for c in cuts}
    Compositor(ff()).compose(cuts=cuts, dest=d / "완성.mp4",
                             bgm=_tone(d / "노래.mp3", 4.0))
    for p, 원래 in 전.items():
        assert p.read_bytes() == 원래, f"{p.name} 이 바뀌었습니다"


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
