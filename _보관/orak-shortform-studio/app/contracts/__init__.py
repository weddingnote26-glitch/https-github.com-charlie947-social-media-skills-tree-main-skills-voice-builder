"""인터페이스 정의 — Stage 1.

여기에는 **구현이 없습니다.** 타입·프로토콜·상수만 있습니다.
표준 라이브러리 외에 아무것도 import 하지 않으므로 어느 환경에서나 불러올 수 있고,
그래서 윈도우가 아닌 곳에서도 계약이 깨졌는지 검사할 수 있습니다.
"""

from app.contracts.errors import ProviderError, Retry, SecretStr
from app.contracts.models import (
    AdDisclosure,
    CostEstimate,
    ReferenceUrl,
    RenderMode,
    RenderPlan,
    Scene,
    SceneStatus,
    Script,
    StoreInfo,
    SubtitleCue,
    VideoJob,
    VideoJobState,
    VideoOutcome,
    VideoRequest,
)

__all__ = [
    "AdDisclosure",
    "CostEstimate",
    "ProviderError",
    "ReferenceUrl",
    "RenderMode",
    "RenderPlan",
    "Retry",
    "Scene",
    "SceneStatus",
    "Script",
    "SecretStr",
    "StoreInfo",
    "SubtitleCue",
    "VideoJob",
    "VideoJobState",
    "VideoOutcome",
    "VideoRequest",
]
