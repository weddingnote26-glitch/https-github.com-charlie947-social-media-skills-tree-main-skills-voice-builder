"""데이터 계약 — Stage 1 인터페이스 정의. 구현 없음.

여기 있는 타입들은 화면·파이프라인·Provider·DB 가 **같은 말을 쓰게** 하는 사전입니다.
표준 라이브러리만 씁니다. 나중에 pydantic 으로 검증을 붙이더라도 이 모양은 유지합니다.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Optional

# ─────────────────────────────────────────────────────────────
# 바뀌지 않는 규격 (지시서 §1 · §2-1 · §8)
# ─────────────────────────────────────────────────────────────

VIDEO_WIDTH = 1080
VIDEO_HEIGHT = 1920
VIDEO_FPS = 30
MAX_TOTAL_SEC = 30.0
"""완성본 길이 상한. **넘으면 합성을 시작하지 않는다.** 자동으로 잘라내지 않는다 (§8)."""

SCENE_COUNT_MIN = 4
SCENE_COUNT_MAX = 6
SCENE_COUNT_DEFAULT = 5

KLING_ALLOWED_DURATION_SEC = (5, 10)
"""Kling 이 만들 수 있는 길이는 **5초 또는 10초뿐**이다 (§2-1).

3초를 요청하면 파라미터 오류(1201)가 난다. Scene 1 은 3초만 쓰지만 5초로 만든 뒤
FFmpeg 로 앞 3초를 잘라 쓴다. 그래서 `VideoRequest.request_sec`(요청·과금 길이)와
`Scene.use_sec`(실제로 쓰는 길이)는 **다른 값이며 절대 섞으면 안 된다.**
"""

KLING_MIN_IMAGE_PX = 300
KLING_MAX_IMAGE_MB = 50
KLING_IMAGE_ASPECT_RANGE = (1 / 2.5, 2.5)
KLING_RESULT_TTL_DAYS = 30
"""Kling 결과 URL 은 30일 뒤 삭제된다. succeeded 즉시 내려받아야 한다 (MVP 판정 20번)."""

SUBTITLE_MAX_LINES = 2
SUBTITLE_MAX_CHARS_PER_LINE = 16
SUBTITLE_SAFE_BAND_PCT = (55, 75)
"""자막이 놓일 화면 세로 구간. 위 14%·아래 20%는 앱 UI가 가린다 (§7)."""

KOREAN_CHARS_PER_SEC = (5.0, 6.0)
"""한국어 낭독 속도 어림값. Scene narration 글자 수 상한을 정하는 데 쓴다 (§6)."""


# ─────────────────────────────────────────────────────────────
# 열거형
# ─────────────────────────────────────────────────────────────


class RenderMode(str, Enum):
    """이 Scene 을 무엇으로 만드는가. 비용의 거의 전부가 여기서 갈린다 (§1-1)."""

    KLING = "kling"
    """오락이가 나오는 장면. Kling image-to-video. 5초 한 클립 = 약 483원."""

    KENBURNS = "kenburns"
    """실제 사진에 FFmpeg zoompan 으로 느린 줌·팬. **Kling 을 부르지 않는다.**"""

    STILL = "still"
    """정지 이미지. CTA 등."""

    @property
    def costs_money(self) -> bool:
        return self is RenderMode.KLING


class SceneStatus(str, Enum):
    PENDING = "pending"
    GENERATING = "generating"
    COMPLETED = "completed"
    FAILED = "failed"


class ProjectStatus(str, Enum):
    DRAFT = "draft"
    SCRIPTED = "scripted"
    PRODUCING = "producing"
    COMPLETED = "completed"
    FAILED = "failed"


class JobType(str, Enum):
    SCRIPT = "script"
    IMAGE = "image"
    VIDEO = "video"
    TTS = "tts"


# ─────────────────────────────────────────────────────────────
# 담당자 입력 (§4)
# ─────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class ReferenceUrl:
    """담당자가 적어 넣은 참고 주소.

    **프로그램은 이 주소를 절대 열지 않습니다** (§0-4 12번).
    Instagram·네이버는 공개 페이지라도 자동 수집을 약관으로 금지하며,
    당근에서 이미 같은 문제를 겪었습니다.

    이 타입에는 '가져오기'·'열기' 기능이 의도적으로 **없습니다.** 저장하고 화면에
    보여주기만 합니다. 내용 확인은 담당자가 브라우저에서 직접 합니다.
    """

    url: str
    note: str = ""


@dataclass(frozen=True)
class AdDisclosure:
    """대가·협찬 표시 (§5 · 표시광고법 · 공정위 추천보증 심사지침).

    체크되면 자막 생성기가 **자동으로** 시작·중간·끝에 넣습니다.
    담당자가 끌 수 없어야 하므로, 자막을 만드는 모든 경로에서 이 값을
    **필수 인자**로 받습니다. 빠뜨리면 타입 검사에서 걸립니다.
    """

    is_paid: bool
    text: str = "유료광고 포함"
    mid_hold_sec: float = 2.0
    """영상 중간(대략 절반 지점)에 다시 띄우는 시간."""

    @property
    def required(self) -> bool:
        return self.is_paid


@dataclass(frozen=True)
class StoreInfo:
    """담당자가 손으로 입력하는 맛집 정보 (§4). 프로그램이 자동 수집하지 않는다."""

    store_name: str
    area: str
    address: str
    menu: str
    price: str
    features: str
    reason: str
    disclosure: AdDisclosure
    memo: str = ""
    reference_urls: tuple[ReferenceUrl, ...] = ()
    photo_paths: tuple[Path, ...] = ()
    """담당자가 고른 실제 음식·매장 사진. Ken Burns Scene 에 배정된다."""


# ─────────────────────────────────────────────────────────────
# 대본과 Scene (§6)
# ─────────────────────────────────────────────────────────────


@dataclass
class Scene:
    idx: int
    start_sec: float
    end_sec: float
    render_mode: RenderMode
    narration: str = ""
    screen_text: str = ""
    image_prompt: str = ""
    video_prompt: str = ""
    source_photo_path: Optional[Path] = None
    image_path: Optional[Path] = None
    video_path: Optional[Path] = None
    audio_path: Optional[Path] = None
    status: SceneStatus = SceneStatus.PENDING
    error_msg: str = ""
    retry_count: int = 0

    @property
    def use_sec(self) -> float:
        """이 Scene 이 완성본에서 차지하는 길이. Kling 에 요청하는 길이와 다르다."""
        return self.end_sec - self.start_sec


@dataclass
class Script:
    """§6이 요구하는 10가지를 담는다. 담당자가 화면에서 고칠 수 있어야 한다."""

    hook: str
    full_text: str
    scenes: list[Scene]
    title: str
    caption: str
    """게시글 설명. 대가성이면 맨 앞에 「유료광고 포함」이 들어간다 (§5)."""
    hashtags: tuple[str, ...]

    @property
    def total_sec(self) -> float:
        return max((s.end_sec for s in self.scenes), default=0.0)

    @property
    def kling_scenes(self) -> list[Scene]:
        return [s for s in self.scenes if s.render_mode is RenderMode.KLING]


# ─────────────────────────────────────────────────────────────
# 비용 (§11)
# ─────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class CostEstimate:
    """돈이 나가기 전에 화면에 원화로 보여줄 값 (§9 · §11).

    단가는 코드에 박지 않고 ``assets/pricing.json`` 에서 읽는다. 요금은 바뀐다.
    """

    krw: int
    breakdown: tuple[tuple[str, int], ...] = ()
    """("Kling 2클립", 966) 같은 항목별 내역. 화면에 그대로 보여준다."""
    is_complete: bool = True
    """단가를 모르는 항목이 있으면 False. 화면에 "일부 요금 미확인" 을 함께 띄운다."""


@dataclass(frozen=True)
class RenderPlan:
    """[영상 제작] 을 누르기 전에 통과해야 하는 검사 결과.

    여기서 막히면 **API 를 한 번도 부르지 않은 상태**라 돈이 나가지 않는다.
    검사 항목: 총 길이 30초 이하 · Kling 클립 수 한도 · 남은 월 한도.
    """

    scenes: tuple[Scene, ...]
    kling_clip_count: int
    total_sec: float
    estimate: CostEstimate


# ─────────────────────────────────────────────────────────────
# 영상 생성 (§2-1)
# ─────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class VideoRequest:
    """VideoProvider 에 넘기는 한 건의 요청. Kling·Ken Burns 가 같은 타입을 받는다."""

    scene_idx: int
    request_sec: int
    """공급자에게 요청하는 길이. Kling 이면 5 또는 10만 허용 (§2-1).
    Scene 이 실제로 쓰는 길이(``Scene.use_sec``)와 다를 수 있고, **과금은 이 값 기준**이다.
    """
    prompt: str
    first_frame: Optional[Path] = None
    """Kling 의 first_frame. **Gemini 가 만든 9:16 장면 이미지**이지
    오락이 Master Image 가 아니다 (§3). Kling 에는 aspect_ratio 파라미터가 없어
    출력 비율이 입력 이미지를 그대로 따르기 때문이다.
    """
    source_photo: Optional[Path] = None
    """Ken Burns 가 쓸 실제 사진."""
    external_task_id: str = ""
    """계정 안에서 유일한 값. **필수로 넣는다** — 프로그램을 껐다 켜도
    이 값으로 다시 조회해 진행 중이던 작업을 복원한다 (§10-2 · MVP 판정 12번).
    """


@dataclass(frozen=True)
class VideoJob:
    """제출된 작업의 손잡이.

    **DB 에 저장했다가 되살릴 수 있어야 한다.** 프로그램을 껐다 켠 뒤에는
    메모리에 아무것도 남아 있지 않으므로, 이 dataclass 의 필드만으로
    ``VideoProvider.poll()`` 이 동작해야 한다. 이것이 재시작 복원의 전제다.
    """

    provider: str
    scene_idx: int
    external_task_id: str
    vendor_task_id: str = ""
    submitted_at: float = 0.0


class VideoOutcome(str, Enum):
    SUBMITTED = "submitted"
    PROCESSING = "processing"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


@dataclass(frozen=True)
class VideoJobState:
    job: VideoJob
    outcome: VideoOutcome
    remote_url: str = ""
    """**여기에만 두면 안 된다.** 30일 뒤 삭제되므로 succeeded 즉시 내려받는다."""
    duration_sec: float = 0.0
    error: Optional[str] = None
    """담당자에게 보여줄 한국어 문장. 벤더 원문이 아니다."""


# ─────────────────────────────────────────────────────────────
# 자막 (§5 · §7)
# ─────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class SubtitleCue:
    start_sec: float
    end_sec: float
    lines: tuple[str, ...]
    """1~2줄. 한 줄 16자 이하 (§7)."""
    style: str = "body"
    """``assets/subtitle_style.json`` 의 스타일 이름. 광고 표시는 본문과 다른 스타일을 쓴다."""


@dataclass(frozen=True)
class Project:
    folder: Path
    store: StoreInfo
    script: Optional[Script] = None
    status: ProjectStatus = ProjectStatus.DRAFT
    created_at: float = 0.0
    scenes: list[Scene] = field(default_factory=list)
