"""HTTP 한 겹 (2026-08-29 지시).

공급자가 `requests` 를 직접 부르지 않게 한 겹 덮었습니다. 이유가 셋입니다.

1. **시험에서 진짜로 부르지 않으려고.** 가짜를 끼워 넣으면 인터넷 없이도
   흐름 전체를 확인할 수 있습니다.
2. **열쇠가 새지 않게.** 오류 글은 반드시 `masking.scrub()` 을 거칩니다.
   `requests` 예외에는 URL 이 들어가고, 거기에 토큰이 붙어 있을 수 있습니다.
3. **불러오다 죽지 않게.** `requests` 를 파일 맨 위에서 부르지 않습니다.
   윈도우가 아닌 곳에서도 `import app...` 은 되어야 합니다.
"""

from __future__ import annotations

import json as _json
from dataclasses import dataclass, field
from typing import Any, Mapping, Optional, Protocol, runtime_checkable

from app.core import masking

DEFAULT_TIMEOUT = 120.0


@dataclass(frozen=True)
class HttpResponse:
    status: int
    body: bytes = b""
    headers: Mapping[str, str] = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return 200 <= self.status < 300

    @property
    def text(self) -> str:
        return self.body.decode("utf-8", errors="replace")

    def json(self) -> Any:
        try:
            return _json.loads(self.text or "null")
        except ValueError:
            return None


class HttpError(Exception):
    """연결 자체가 안 된 경우. 답이 왔는데 4xx·5xx 인 것은 이게 아닙니다."""

    def __init__(self, detail: str) -> None:
        super().__init__(masking.scrub(detail))
        self.detail = masking.scrub(detail)


@runtime_checkable
class HttpClient(Protocol):
    def request(self, method: str, url: str, *,
                headers: Optional[Mapping[str, str]] = None,
                json: Any = None,
                data: Optional[bytes] = None,
                timeout: float = DEFAULT_TIMEOUT) -> HttpResponse: ...


class RequestsHttp:
    """진짜로 부르는 쪽. `requests` 는 **여기서** 불러옵니다."""

    def request(self, method: str, url: str, *,
                headers: Optional[Mapping[str, str]] = None,
                json: Any = None,
                data: Optional[bytes] = None,
                timeout: float = DEFAULT_TIMEOUT) -> HttpResponse:
        import requests

        try:
            r = requests.request(method, url, headers=dict(headers or {}),
                                 json=json, data=data, timeout=timeout)
        except Exception as exc:                       # 연결 실패·시간 초과
            raise HttpError(f"{type(exc).__name__}: {exc}") from None
        return HttpResponse(status=r.status_code, body=r.content,
                            headers=dict(r.headers))
