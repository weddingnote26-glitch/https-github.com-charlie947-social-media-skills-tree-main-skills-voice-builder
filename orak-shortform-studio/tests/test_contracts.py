"""계약 시험 — Stage 1.

여기서 확인하는 것은 **제품이 아니라 설계**입니다.
"이 인터페이스대로 만들 수 있는가", "위험한 값이 새지 않는가" 만 봅니다.

pytest 로도 돌고, pytest 가 없으면 그냥 실행해도 됩니다:
    python tests/test_contracts.py
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Sequence

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.contracts.errors import (  # noqa: E402
    MASK_TOKEN,
    PlanRejected,
    ProviderError,
    Retry,
    SecretStr,
)
from app.contracts.models import (  # noqa: E402
    KLING_ALLOWED_DURATION_SEC,
    MAX_TOTAL_SEC,
    SUBTITLE_MAX_CHARS_PER_LINE,
    SUBTITLE_MAX_LINES,
    AdDisclosure,
    CostEstimate,
    RenderMode,
    Scene,
    Script,
    SubtitleCue,
    VideoJob,
    VideoJobState,
    VideoOutcome,
    VideoRequest,
)
from app.contracts.providers import SubtitleBuilder, VideoProvider  # noqa: E402


# ─────────────────────────────────────────────────────────────
# 비밀값이 새지 않는가 (§0-3 · §10-3 · MVP 판정 18번)
# ─────────────────────────────────────────────────────────────

SECRET = "sk-ant-api03-THIS-MUST-NEVER-APPEAR"


def test_비밀값은_어떤_방식으로_찍어도_새지_않는다() -> None:
    key = SecretStr(SECRET)
    ways = [
        str(key),
        repr(key),
        f"{key}",
        f"{key!r}",
        f"{key!s}",
        "%s" % key,
        "{}".format(key),
        str([key]),
        str({"api_key": key}),
        str((key,)),
        key.hint(),
    ]
    for shown in ways:
        assert SECRET not in shown, f"원문이 샜습니다: {shown}"
        assert "THIS-MUST-NEVER-APPEAR" not in shown
    assert key.reveal() == SECRET, "reveal() 로는 꺼낼 수 있어야 합니다"


def test_비밀값_힌트는_앞_세글자만_보여준다() -> None:
    assert SecretStr("sk-ant-1234").hint() == f"sk-...{MASK_TOKEN}"
    assert SecretStr("ab").hint() == f"...{MASK_TOKEN}"


def test_예외에_담아도_새지_않는다() -> None:
    key = SecretStr(SECRET)
    err = ProviderError(
        retry=Retry.NEVER_AUTH,
        user_message="사용 키에 문제가 있습니다. 회사에 문의해 주세요.",
        log_detail=f"auth failed key={key}",
        provider="kling",
        vendor_code="1004",
    )
    assert SECRET not in str(err)
    assert SECRET not in repr(err)
    assert SECRET not in err.log_detail
    assert err.vendor_code not in str(err), "벤더 코드는 화면 문구에 없어야 합니다"


# ─────────────────────────────────────────────────────────────
# 재시도 분류 (MVP 판정 21 · 22번)
# ─────────────────────────────────────────────────────────────


def test_파라미터_오류는_자동재시도하지_않는다() -> None:
    assert Retry.NEVER_PARAM.is_automatic is False
    assert Retry.NEVER_AUTH.is_automatic is False
    assert Retry.NEVER_CONTENT.is_automatic is False
    assert Retry.MANUAL.is_automatic is False


def test_동시성초과만_자동재시도한다() -> None:
    assert Retry.BACKOFF.is_automatic is True
    automatic = [r for r in Retry if r.is_automatic]
    assert automatic == [Retry.BACKOFF], "자동 재시도는 백오프 하나뿐이어야 합니다"


# ─────────────────────────────────────────────────────────────
# 렌더 방식과 비용 (§1-1)
# ─────────────────────────────────────────────────────────────


def test_켄번스는_돈이_나가지_않는다() -> None:
    assert RenderMode.KLING.costs_money is True
    assert RenderMode.KENBURNS.costs_money is False
    assert RenderMode.STILL.costs_money is False


def test_클링은_5초_또는_10초만_만든다() -> None:
    assert KLING_ALLOWED_DURATION_SEC == (5, 10)
    assert 3 not in KLING_ALLOWED_DURATION_SEC, "3초를 요청하면 1201 오류가 납니다"


def _표준_5장() -> list[Scene]:
    """지시서 §1-1의 기본 구성."""
    return [
        Scene(idx=1, start_sec=0, end_sec=3, render_mode=RenderMode.KLING),
        Scene(idx=2, start_sec=3, end_sec=7, render_mode=RenderMode.KENBURNS),
        Scene(idx=3, start_sec=7, end_sec=12, render_mode=RenderMode.KENBURNS),
        Scene(idx=4, start_sec=12, end_sec=17, render_mode=RenderMode.KLING),
        Scene(idx=5, start_sec=17, end_sec=23, render_mode=RenderMode.KENBURNS),
    ]


def test_기본구성은_클링_2클립_30초이내다() -> None:
    script = Script(
        hook="h", full_text="f", scenes=_표준_5장(),
        title="t", caption="c", hashtags=(),
    )
    assert len(script.kling_scenes) == 2, "기본은 Kling 2클립입니다 (§1-1)"
    assert script.total_sec <= MAX_TOTAL_SEC


def test_씬1은_3초를_쓰지만_5초를_요청한다() -> None:
    scene = _표준_5장()[0]
    assert scene.use_sec == 3, "완성본에서 쓰는 길이"
    req = VideoRequest(scene_idx=1, request_sec=5, prompt="p")
    assert req.request_sec in KLING_ALLOWED_DURATION_SEC
    assert req.request_sec != scene.use_sec, "요청 길이와 사용 길이는 다른 값입니다"


# ─────────────────────────────────────────────────────────────
# 광고 표시가 빠질 수 없는가 (§5 · MVP 판정 17번)
# ─────────────────────────────────────────────────────────────


class _자막생성기:
    """계약을 지키는 최소 구현. 광고 표시를 넣는지만 봅니다."""

    def build_cues(
        self, scenes: Sequence[Scene], *, disclosure: AdDisclosure
    ) -> list[SubtitleCue]:
        cues = [
            SubtitleCue(s.start_sec, s.end_sec, (s.screen_text,), "body") for s in scenes
        ]
        if disclosure.required:
            first, last = scenes[0], scenes[-1]
            half = last.end_sec / 2
            cues += [
                SubtitleCue(first.start_sec, first.end_sec, (disclosure.text,), "ad_disclosure"),
                SubtitleCue(half, half + disclosure.mid_hold_sec, (disclosure.text,), "ad_disclosure"),
                SubtitleCue(last.start_sec, last.end_sec, (disclosure.text,), "ad_disclosure"),
            ]
        return cues

    def write_ass(self, cues: Sequence[SubtitleCue], dest: Path) -> Path:
        return dest


def test_대가성이면_시작_중간_끝에_자동으로_들어간다() -> None:
    scenes = _표준_5장()
    cues = _자막생성기().build_cues(scenes, disclosure=AdDisclosure(is_paid=True))
    ads = [c for c in cues if c.style == "ad_disclosure"]
    assert len(ads) == 3, "시작·중간·끝 세 번 나와야 합니다"
    assert ads[0].start_sec == 0, "시작"
    assert ads[-1].end_sec == scenes[-1].end_sec, "끝"
    mid = ads[1]
    assert 0 < mid.start_sec < scenes[-1].end_sec, "중간"
    assert all(c.style != "body" for c in ads), "본문과 다른 스타일이어야 합니다"


def test_대가성이_아니면_넣지_않는다() -> None:
    cues = _자막생성기().build_cues(_표준_5장(), disclosure=AdDisclosure(is_paid=False))
    assert not [c for c in cues if c.style == "ad_disclosure"]


def test_광고표시는_인자를_빼먹을_수_없다() -> None:
    """disclosure 가 키워드 필수 인자라 그냥 부르면 실패합니다."""
    try:
        _자막생성기().build_cues(_표준_5장())  # type: ignore[call-arg]
    except TypeError:
        pass
    else:  # pragma: no cover
        raise AssertionError("광고 표시 인자를 빼고도 자막이 만들어졌습니다")


def test_자막_한줄_규칙() -> None:
    assert SUBTITLE_MAX_LINES == 2
    assert SUBTITLE_MAX_CHARS_PER_LINE == 16


# ─────────────────────────────────────────────────────────────
# VideoProvider 하나로 Kling 과 Ken Burns 를 다 받는가
# ─────────────────────────────────────────────────────────────


class _켄번스:
    """제출하는 순간 끝나는 공급자. 파이프라인이 갈라지지 않는지 봅니다."""

    name = "kenburns"

    def health(self) -> tuple[bool, str]:
        return True, "쓸 수 있습니다."

    def estimate(self, req: VideoRequest) -> CostEstimate:
        return CostEstimate(krw=0, breakdown=(("Ken Burns", 0),))

    def submit(self, req: VideoRequest) -> VideoJob:
        return VideoJob(provider=self.name, scene_idx=req.scene_idx,
                        external_task_id=req.external_task_id)

    def poll(self, jobs: Sequence[VideoJob]) -> list[VideoJobState]:
        return [VideoJobState(job=j, outcome=VideoOutcome.SUCCEEDED) for j in jobs]

    def download(self, state: VideoJobState, dest: Path) -> Path:
        return dest


def test_켄번스가_VideoProvider_계약을_만족한다() -> None:
    assert isinstance(_켄번스(), VideoProvider)


def test_자막생성기가_SubtitleBuilder_계약을_만족한다() -> None:
    assert isinstance(_자막생성기(), SubtitleBuilder)


def test_켄번스는_비용이_0원이다() -> None:
    kb = _켄번스()
    assert kb.estimate(VideoRequest(scene_idx=2, request_sec=5, prompt="")).krw == 0


def test_여러건을_한번에_조회한다() -> None:
    """Kling 은 task_ids=A,B,C 로 한 번에 봅니다. 계약도 목록을 받습니다."""
    kb = _켄번스()
    jobs = [kb.submit(VideoRequest(scene_idx=i, request_sec=5, prompt="",
                                   external_task_id=f"orak-{i}")) for i in (2, 3, 5)]
    states = kb.poll(jobs)
    assert len(states) == len(jobs)
    assert all(s.outcome is VideoOutcome.SUCCEEDED for s in states)


def test_작업손잡이는_DB에_넣었다_빼도_살아난다() -> None:
    """재시작 복원의 전제 (MVP 판정 12번).

    VideoJob 의 필드만으로 poll 이 동작해야 합니다.
    """
    import dataclasses

    original = _켄번스().submit(
        VideoRequest(scene_idx=4, request_sec=5, prompt="p", external_task_id="orak-20260901-s4")
    )
    저장된값 = dataclasses.asdict(original)          # DB 에 넣는다
    되살린것 = VideoJob(**저장된값)                    # 다시 켠 뒤 꺼낸다
    assert 되살린것 == original
    assert 되살린것.external_task_id, "external_task_id 가 비면 다시 찾을 수 없습니다"
    states = _켄번스().poll([되살린것])
    assert states[0].outcome is VideoOutcome.SUCCEEDED


def test_결과는_URL만_들고있지_않는다() -> None:
    """Kling 결과는 30일 뒤 삭제됩니다 (MVP 판정 20번).

    그래서 download() 가 계약에 들어 있고, 빼먹으면 계약을 만족하지 못합니다.
    """
    assert hasattr(_켄번스(), "download")


# ─────────────────────────────────────────────────────────────
# 참고 URL 을 프로그램이 열지 않는가 (§0-4)
# ─────────────────────────────────────────────────────────────


def test_참고URL_타입에는_가져오기_기능이_없다() -> None:
    from app.contracts.models import ReferenceUrl

    url = ReferenceUrl(url="https://example.com/store", note="담당자 메모")
    금지 = {"fetch", "get", "open", "read", "download", "scrape", "request"}
    있는것 = {m for m in dir(url) if not m.startswith("_")}
    assert not (있는것 & 금지), f"자동 수집으로 이어질 수 있는 기능: {있는것 & 금지}"
    assert 있는것 == {"url", "note"}


# ─────────────────────────────────────────────────────────────
# 돈이 나가기 전에 멈추는가 (§8 · §11)
# ─────────────────────────────────────────────────────────────


def test_계획거부는_고칠_방법을_알려준다() -> None:
    e = PlanRejected(
        user_message="영상이 30초를 넘습니다. 어느 장면을 줄일지 골라주세요.",
        hints=("Scene 3 을 2초 줄이기", "Scene 5 를 3초 줄이기"),
    )
    assert e.hints, "무엇을 고치면 되는지 알려줘야 합니다"
    assert "30초" in e.user_message


def test_요금을_모르면_숨기지_않고_알린다() -> None:
    부분 = CostEstimate(krw=1021, breakdown=(("Kling 2클립", 966), ("음성", 55)),
                        is_complete=False)
    assert 부분.is_complete is False, "미확인 요금이 있으면 화면에 그렇게 표시합니다"
    assert sum(v for _, v in 부분.breakdown) == 부분.krw


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
