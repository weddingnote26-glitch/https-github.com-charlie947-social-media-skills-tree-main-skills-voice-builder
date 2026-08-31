"""외부 서비스 추상화 — Stage 1 인터페이스 정의. 구현 없음.

지시서 §1이 요구한 것: 이미지는 "Provider 교체 가능하게", 영상은 "VideoProvider 추상화".
여기 있는 것은 전부 ``typing.Protocol`` 이라 상속이 필요 없고, 시험용 가짜 Provider 를
만들기도 쉽습니다. 실제 API 를 부르지 않고 파이프라인 전체를 시험할 수 있어야 하는데,
지금 개발 환경에서 Kling·Gemini·ElevenLabs 가 전부 막혀 있어 특히 중요합니다.

**모든 Provider 가 지키는 약속 세 가지**

1. 벤더 오류를 ``ProviderError`` 로 번역해서 올린다. 바깥은 HTTP 코드를 보지 않는다.
2. 부르기 전에 ``estimate()`` 로 원화 예상 비용을 답할 수 있다.
3. API 키를 로그·예외 메시지에 넣지 않는다. 키는 ``SecretStr`` 로만 받는다.
"""

from __future__ import annotations

from pathlib import Path
from typing import Protocol, Sequence, runtime_checkable

from app.contracts.models import (
    AdDisclosure,
    CostEstimate,
    Scene,
    Script,
    StoreInfo,
    SubtitleCue,
    VideoJob,
    VideoJobState,
    VideoRequest,
)


@runtime_checkable
class Provider(Protocol):
    """모든 공급자의 공통 부분."""

    name: str
    """로그와 ``generation_jobs.provider`` 에 남길 이름. 예: "kling" "kenburns"."""

    def health(self) -> tuple[bool, str]:
        """[연결 테스트] 버튼이 부르는 것.

        Returns:
            (되는가, 담당자에게 보여줄 한국어 한 문장)
        """
        ...


@runtime_checkable
class ScriptProvider(Provider, Protocol):
    """대본 생성 (§6). Anthropic Claude. 모델명은 Settings 에서 받는다."""

    def estimate(self, store: StoreInfo, scene_count: int) -> CostEstimate: ...

    def generate(self, store: StoreInfo, scene_count: int) -> Script:
        """10가지를 한 번에 만든다.

        JSON 스키마를 벗어나면 **최대 2회 재생성**한다 (§6).
        Scene 별 narration 글자 수는 그 Scene 시간 × 초당 5~6자를 넘지 않는다.
        과장 표현(최고·1등·무조건·대박·역대급)은 생성 단계에서 막는다.
        """
        ...


@runtime_checkable
class ImageProvider(Provider, Protocol):
    """장면 이미지 생성 (§2-3 · §3). 기본은 Gemini, 교체 가능.

    ⚠️ Stage 5 착수 전에 **요청 JSON 형식과 장당 요금을 확인**해야 한다.
    공식 문서가 현재 개발 환경에서 막혀 있어 추측으로 구현하지 않는다 (§0-2 6번).
    """

    def estimate(self, count: int) -> CostEstimate: ...

    def generate_scene_image(
        self,
        *,
        prompt: str,
        character_refs: Sequence[Path],
        negative_prompt: str,
        dest: Path,
    ) -> Path:
        """9:16(1080×1920) 장면 이미지 한 장.

        Args:
            character_refs: 오락이 Master Image. **오락이 Scene 마다 3장을 모두** 넣는다.
                Gemini 3.1 Flash 는 캐릭터 참조를 최대 4장 받는다 (§2-3).
                한 장만 넣는 것보다 일관성이 확연히 좋아진다.
            dest: 저장할 로컬 경로.

        Note:
            실제 사진이 없어 이 이미지를 쓰는 Scene 은 화면 우하단에
            「AI 생성 이미지」 표기를 넣는다 (§1-1). 실제 매장 사진으로 오인시키면 안 된다.
        """
        ...


@runtime_checkable
class VideoProvider(Provider, Protocol):
    """Scene 하나를 영상으로 만든다. Kling 과 Ken Burns 가 **같은 인터페이스**를 쓴다.

    Kling 은 제출하고 기다리는 방식이고 Ken Burns 는 그 자리에서 끝나지만,
    파이프라인이 두 갈래로 갈라지지 않도록 둘 다 submit → poll → download 를 따른다.
    Ken Burns 는 submit 시점에 이미 끝나 있고 poll 이 곧바로 SUCCEEDED 를 답한다.
    """

    def estimate(self, req: VideoRequest) -> CostEstimate:
        """이 한 건에 얼마가 드는가. Ken Burns 는 0원."""
        ...

    def submit(self, req: VideoRequest) -> VideoJob:
        """작업을 넣고 손잡이를 받는다.

        받은 ``VideoJob`` 은 **곧바로 DB 에 저장**한다. 저장하기 전에 프로그램이
        꺼지면 이미 돈이 나간 작업을 잃어버린다.
        """
        ...

    def poll(self, jobs: Sequence[VideoJob]) -> list[VideoJobState]:
        """여러 건을 **한 번에** 조회한다.

        Kling 은 ``GET /tasks?task_ids=A,B,C`` 로 쉼표 여러 건을 지원하고
        조회는 동시성을 소모하지 않는다 (§2-1). Scene 5개를 한 번에 확인한다.

        인자로 받는 ``VideoJob`` 은 DB 에서 되살린 것일 수 있다.
        그래도 동작해야 한다 — 재시작 복원이 이것에 달려 있다.
        """
        ...

    def download(self, state: VideoJobState, dest: Path) -> Path:
        """결과를 로컬 파일로 내려받는다.

        **succeeded 를 받는 즉시 부른다.** Kling 결과는 30일 뒤 삭제되므로
        URL 만 저장해두면 안 된다 (MVP 판정 20번). 내려받은 로컬 경로를 DB 에 적는다.
        """
        ...


@runtime_checkable
class TTSProvider(Provider, Protocol):
    """Scene 별 한국어 음성 (§2-2). ElevenLabs.

    모델 목록은 ``GET /v1/models`` 로 조회해 Settings 에서 고르게 한다. 하드코딩 금지.
    Voice ID 도 담당자가 Settings 에 직접 넣는다.
    """

    def list_models(self) -> list[tuple[str, str]]:
        """(모델 id, 화면에 보여줄 이름) 목록."""
        ...

    def estimate(self, text: str) -> CostEstimate:
        """한글 글자 수 ÷ 1000 × 1K자 단가."""
        ...

    def synthesize(self, *, text: str, voice_id: str, model: str, dest: Path) -> Path: ...


@runtime_checkable
class SubtitleBuilder(Protocol):
    """ASS 자막을 만든다 (§5 · §7).

    ``disclosure`` 가 **필수 인자**인 것이 핵심이다. 광고 표시를 넣는 경로를
    빠뜨릴 수 없게 타입으로 묶어 두었다. 담당자가 끌 수 있는 스위치는 없다.
    """

    def build_cues(
        self, scenes: Sequence[Scene], *, disclosure: AdDisclosure
    ) -> list[SubtitleCue]:
        """본문 자막 + 광고 표시 자막을 합쳐 돌려준다.

        ``disclosure.is_paid`` 가 참이면 다음이 **자동으로** 들어간다 (§5).

        - Scene 1 전체 구간 상단
        - 영상 중간(대략 절반 지점) 2초
        - 마지막 Scene 전체 구간 상단

        본문 자막과 구분되는 스타일(배경 박스 + 충분한 크기)을 쓴다.
        읽히지 않으면 표시하지 않은 것과 같다.
        """
        ...

    def write_ass(self, cues: Sequence[SubtitleCue], dest: Path) -> Path: ...


@runtime_checkable
class Compositor(Protocol):
    """최종 합성 (§8). FFmpeg.

    합성 순서: Scene 영상 이어붙이기 → 음성 트랙 → BGM → 자막 burn-in.
    BGM 은 voice 대비 -18dB 에서 시작한다.
    """

    def validate_length(self, scenes: Sequence[Scene]) -> None:
        """**합성을 시작하기 전에** 총 길이를 검사한다.

        30초를 넘으면 ``PlanRejected`` 를 올리고 어느 Scene 을 줄여야 하는지 알려준다.
        **자동으로 잘라내지 않는다** (§8).
        """
        ...

    def compose(
        self,
        *,
        scenes: Sequence[Scene],
        subtitle_ass: Path,
        bgm: Path | None,
        dest: Path,
    ) -> Path:
        """1080×1920 · H.264 · yuv420p · 30fps · AAC 128k/44.1kHz MP4."""
        ...
