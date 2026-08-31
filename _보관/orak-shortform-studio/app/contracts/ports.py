"""프로그램 안쪽 경계 — Stage 1 인터페이스 정의. 구현 없음.

Provider 가 '바깥 세상'과의 경계라면, 여기는 '우리 PC'와의 경계입니다.
파일·DB·설정·비용·키가 여기를 통해서만 오갑니다.
"""

from __future__ import annotations

from enum import Enum
from pathlib import Path
from typing import Optional, Protocol, Sequence, runtime_checkable

from app.contracts.errors import SecretStr
from app.contracts.models import (
    CostEstimate,
    Project,
    RenderPlan,
    Scene,
    Script,
    StoreInfo,
    VideoJob,
)


# ─────────────────────────────────────────────────────────────
# 경로 — 분리규칙을 코드로 강제한다
# ─────────────────────────────────────────────────────────────


@runtime_checkable
class Paths(Protocol):
    """폴더 위치와 **쓰기 허용 범위**.

    분리규칙 §2의 표를 사람의 주의력에 맡기지 않고 코드가 지키게 한다.
    ``assert_writable`` 을 거치지 않은 쓰기는 코드 리뷰에서 걸러낸다.
    """

    def data_root(self) -> Path:
        """실행 중 프로그램이 쓰는 곳: ``내 문서\\ORAK_SHORTFORM_STUDIO\\``"""
        ...

    def bundled_assets_dir(self) -> Path:
        """프로그램에 **동봉된** 자산 폴더. 읽기 전용.

        분리규칙 §2 갱신본: 마스터 이미지 3장은 저장소 ``assets\\master\\`` 에 두고
        EXE 에 동봉한다. 완성된 프로그램은 바탕화면의 「오락이 마스터 파일」을
        **볼 필요가 없고 봐서도 안 된다.** 바탕화면 전체가 접근 금지다.

        - 개발 중  : 저장소의 ``assets/``
        - EXE 실행 : PyInstaller 가 풀어놓은 임시 폴더 (``sys._MEIPASS``)

        두 경우를 여기서 흡수하므로 바깥 코드는 구분하지 않는다.
        """
        ...

    def master_images(self) -> list[Path]:
        """오락이 Master Image 3장의 실제 경로. ``bundled_assets_dir()/master/`` 아래.

        ``character_profile.json`` 의 「마스터이미지」 항목이 정본이다.
        파일이 없으면 빈 목록이 아니라 **한국어 안내와 함께 예외**를 올린다 —
        말없이 한 장만 넣고 진행하면 캐릭터가 흔들린다.
        """
        ...

    def project_dir(self, project: Project) -> Path:
        """``Projects\\20260901_할머니국수\\`` — 하위에 source/script/images/
        videos/audio/subtitle/final 을 둔다 (§10-1).

        같은 이름이 이미 있으면 **덮지 않고** ``_2`` ``_3`` 을 붙이고 알린다 (§0-1 3번).
        """
        ...

    def assert_writable(self, path: Path) -> None:
        """이 경로에 써도 되는가. 아니면 즉시 예외.

        허용: ``data_root()`` 아래.
        금지: 그 밖의 모든 곳 — **바탕화면 전체**, A(당근 카드뉴스)의 모든 폴더,
              ``bundled_assets_dir()``, 이미 있는 프로젝트 폴더.

        와일드카드로 폴더를 찾지 않는다. 두 프로그램 폴더가 전부 ``오락_`` 으로
        시작하므로 전체 경로를 문자 그대로 비교한다 (분리규칙 §3-2).
        """
        ...


# ─────────────────────────────────────────────────────────────
# 저장 (§10-2)
# ─────────────────────────────────────────────────────────────


@runtime_checkable
class Repository(Protocol):
    """SQLite. 표는 projects · project_urls · scenes · generation_jobs · settings.

    **settings 표에 API 키를 넣지 않는다** (§10-2). 키는 DPAPI 로만 보관한다.
    """

    def save_project(self, project: Project) -> Project: ...

    def save_script(self, project: Project, script: Script) -> None: ...

    def update_scene(self, project: Project, scene: Scene) -> None:
        """**한 Scene 이 실패해도 다른 Scene 을 지우지 않는다** (§10-2).
        실패한 Scene 만 다시 만들 수 있어야 한다.
        """
        ...

    def record_job(
        self, project: Project, job: VideoJob, *, cost_krw: int, error_code: str = ""
    ) -> None:
        """``generation_jobs`` 에 한 줄. ``external_task_id`` 를 반드시 남긴다."""
        ...

    def unfinished_jobs(self) -> list[VideoJob]:
        """프로그램을 다시 켰을 때 이어서 조회할 작업들 (MVP 판정 12번).

        여기서 돌려준 ``VideoJob`` 만으로 ``VideoProvider.poll()`` 이 동작해야 한다.
        """
        ...

    def month_to_date_krw(self) -> int:
        """이번 달 누적 사용액. 화면 하단에 항상 표시한다 (§11)."""
        ...


# ─────────────────────────────────────────────────────────────
# 키 보관 (§10-3)
# ─────────────────────────────────────────────────────────────


@runtime_checkable
class CredentialStore(Protocol):
    """Windows DPAPI (``win32crypt.CryptProtectData``).

    암호문은 ``Settings\\credentials.dat`` 에만 있다.
    SQLite·JSON·로그·백업·배포 ZIP 어디에도 평문이 없어야 한다 (MVP 판정 18번).
    """

    def get(self, key: str) -> Optional[SecretStr]: ...

    def put(self, key: str, value: SecretStr) -> None: ...

    def hint(self, key: str) -> str:
        """화면에 보여줄 형태. 예: ``sk-...★★★★``"""
        ...


@runtime_checkable
class Masker(Protocol):
    """로그로 나가는 모든 문자열이 지나는 관문 (§10-3).

    이 함수에는 **단위시험을 붙인다**. 지시서가 명시한 몇 안 되는 시험 요구사항이다.
    """

    def scrub(self, text: str) -> str:
        """알려진 키 값과 키처럼 생긴 문자열을 ★★★★ 로 바꾼다."""
        ...


# ─────────────────────────────────────────────────────────────
# 비용 (§11)
# ─────────────────────────────────────────────────────────────


class GateDecision(Enum):
    ALLOW = "allow"
    WARN = "warn"
    """80% 초과. 경고를 띄우되 진행은 허용."""
    BLOCK = "block"
    """100% 초과. 생성을 막고 "이번 달 한도에 도달했습니다. 회사에 문의해 주세요."."""


@runtime_checkable
class Pricing(Protocol):
    """``Settings\\pricing.json`` 을 읽는다. 단가를 코드에 상수로 박지 않는다 (§11).

    요금은 바뀐다. 그리고 담당자 사용법 문서의 "1편에 약 ○○원"도 여기서 읽어 표시한다.
    """

    def exchange_rate(self) -> float:
        """원/달러. 기본 1380."""
        ...

    def kling_per_sec_usd(self, model: str, resolution: str) -> Optional[float]: ...

    def image_per_unit_usd(self, model: str) -> Optional[float]:
        """⚠️ Gemini 장당 요금은 **아직 확인되지 않았다.** 모르면 None 을 돌려주고,
        ``CostEstimate.is_complete`` 를 False 로 만들어 화면에 그렇게 표시한다.
        """
        ...

    def tts_per_1k_chars_usd(self, model: str) -> Optional[float]: ...

    def llm_per_mtok_usd(self, model: str) -> Optional[tuple[float, float]]:
        """(입력, 출력) 백만 토큰당 달러."""
        ...


@runtime_checkable
class CostGate(Protocol):
    """돈이 나가기 전에 서는 문 (§11)."""

    def monthly_limit_krw(self) -> int:
        """``Settings`` 의 ``월_한도_원``. 기본 50000."""
        ...

    def max_kling_clips(self) -> int:
        """``1편_최대_Kling클립수``. 기본 2, 상한 3 (§1-1)."""
        ...

    def check(self, estimate: CostEstimate) -> GateDecision: ...

    def build_plan(self, script: Script) -> RenderPlan:
        """[영상 제작] 을 누르기 전 검사 전체.

        총 길이 30초 이하 · Kling 클립 수 한도 이하 · 남은 월 한도 이내.
        하나라도 걸리면 ``PlanRejected`` 를 올린다. **API 는 한 번도 부르지 않는다.**
        """
        ...


# ─────────────────────────────────────────────────────────────
# 자산 설정 파일
# ─────────────────────────────────────────────────────────────


@runtime_checkable
class CharacterProfile(Protocol):
    """``assets\\character_profile.json`` (§3).

    고정 문구를 코드가 아니라 이 파일에 두는 이유는 나중에 고칠 수 있어야 하기 때문이다.
    """

    def master_images(self) -> list[Path]:
        """오락이 Master Image 3장. **오락이 Scene 마다 3장을 모두** 참조로 붙인다."""
        ...

    def identity_lock(self) -> str:
        """Scene 마다 **같은 문장으로 반복해서** 넣는 외형 고정 문구.
        Scene 마다 다르게 표현하면 캐릭터가 흔들린다.
        """
        ...

    def composition_prompt(self) -> str:
        """구도 규칙 (§3).

        캐릭터 세로 12%~78% · 하단 35%는 배경만(자막 자리) · 발이 화면 바닥에 닿지 않게.
        이걸 빼면 자막이 캐릭터 옷 위에 얹히고 릴스 UI가 신발을 가린다.
        """
        ...

    def negative_prompt(self) -> str:
        """실제 상호명·간판 글씨·실존 인물·브랜드 로고가 들어가지 않게 한다."""
        ...

    def background_choices(self) -> list[str]:
        """마스터 7장이 전부 같은 베이지 단색 배경이라, 지시하지 않으면 생성 이미지도
        스튜디오처럼 비어 나온다. **매번 골라서 명시**한다.
        """
        ...

    def validate(self) -> list[str]:
        """설정이 쓸 수 있는 상태인가. 문제 목록을 한국어로 돌려준다.

        마스터 이미지 3장이 실제로 있는지, 크기·형식이 Kling·Gemini 제약에 맞는지 등.
        빈 목록이면 정상.
        """
        ...


@runtime_checkable
class SubtitleStyle(Protocol):
    """``assets\\subtitle_style.json`` (§7).

    담당자가 나중에 "글씨 더 크게"라고 한다. 그때 EXE 를 다시 빌드하지 않아도 되게
    EXE 옆에 풀어놓은 파일에서 읽는다.
    """

    def font_path(self) -> Path:
        """재배포 가능한 폰트만 (Noto Sans KR · OFL). 맑은 고딕 금지 (§7)."""
        ...

    def style_names(self) -> list[str]:
        """최소한 "body" 와 광고 표시용 스타일이 있어야 한다."""
        ...
