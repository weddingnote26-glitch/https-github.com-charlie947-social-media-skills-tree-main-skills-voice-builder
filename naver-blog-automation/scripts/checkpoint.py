# -*- coding: utf-8 -*-
"""
체크포인트 — 브라우저 작업이 중간에 멈춰도 이어서 할 수 있게 합니다.

  로그인 만료, 본인인증, 팝업, 인터넷 끊김 때문에 작업이 멈출 수 있습니다.
  그때마다 처음부터 다시 하면 이미 올린 이미지가 두 번 올라갑니다.
  그래서 단계마다 기록을 남기고, 다시 실행하면 그 다음부터 시작합니다.

  기록 위치: <글폴더>/publish/result.json
"""
from __future__ import annotations

from pathlib import Path

from scripts import common as c

# 브라우저가 밟아 가는 단계
STEPS = [
    "opened",            # 브라우저를 열고 로그인 확인
    "channel_verified",  # 블로그 ID 등 7가지 확인
    "editor_opened",     # 글쓰기 화면을 엶
    "title_filled",      # 제목 입력
    "body_filled",       # 본문 입력
    "images_uploaded",   # 이미지 올림
    "tags_filled",       # 태그 입력
    "draft_saved",       # 비공개 저장
    "reservation_set",   # 예약 설정
    "reservation_saved",  # 예약 저장
]

STEP_KO = {
    "opened":            "브라우저 열기",
    "channel_verified":  "채널 확인",
    "editor_opened":     "글쓰기 화면 열기",
    "title_filled":      "제목 입력",
    "body_filled":       "본문 입력",
    "images_uploaded":   "이미지 올리기",
    "tags_filled":       "태그 입력",
    "draft_saved":       "비공개 저장",
    "reservation_set":   "예약 설정",
    "reservation_saved": "예약 저장",
}


def path_for(pdir: Path) -> Path:
    return pdir / "publish" / "result.json"


def load(pdir: Path) -> dict:
    data = c.read_json(path_for(pdir), default=None)
    if not isinstance(data, dict):
        data = {}
    data.setdefault("checkpoints", [])
    data.setdefault("failures", [])
    data.setdefault("steps", {})
    data.setdefault("uploaded_images", [])
    return data


def save(pdir: Path, data: dict) -> None:
    c.ensure_dir(path_for(pdir).parent)
    c.write_json(path_for(pdir), data)


def done_steps(pdir: Path) -> set[str]:
    return {x["step"] for x in load(pdir).get("checkpoints", []) if x.get("ok")}


def mark(pdir: Path, step: str, note: str = "", **extra) -> None:
    data = load(pdir)
    data["checkpoints"] = [x for x in data["checkpoints"] if x.get("step") != step]
    data["checkpoints"].append({
        "step": step,
        "ok": True,
        "at": c.now_kst().strftime("%Y-%m-%d %H:%M:%S KST"),
        "note": note,
        **extra,
    })
    save(pdir, data)


def mark_uploaded(pdir: Path, filename: str) -> None:
    """이미 올린 이미지를 기록해 두 번 올리지 않게 합니다."""
    data = load(pdir)
    if filename not in data["uploaded_images"]:
        data["uploaded_images"].append(filename)
    save(pdir, data)


def already_uploaded(pdir: Path) -> list[str]:
    return load(pdir).get("uploaded_images", [])


def record_failure(pdir: Path, step: str, message: str,
                   url: str = "", shot: str = "", todo: str = "") -> dict:
    data = load(pdir)
    entry = {
        "step": step,
        "step_ko": STEP_KO.get(step, step),
        "at": c.now_kst().strftime("%Y-%m-%d %H:%M:%S KST"),
        "message": message,
        "url": url,
        "screenshot": shot,
        "user_action": todo,
        "resume_from": step,
    }
    data["failures"].append(entry)
    save(pdir, data)
    return entry


def resume_point(pdir: Path) -> str | None:
    """이어서 시작할 단계. 다 끝났으면 None."""
    done = done_steps(pdir)
    for s in STEPS:
        if s not in done:
            return s
    return None


def progress_text(pdir: Path) -> str:
    done = done_steps(pdir)
    return f"{len(done)}/{len(STEPS)} 단계 완료"


def write_failure_report(pdir: Path, entry: dict) -> Path:
    lines = [
        "# 작업이 중간에 멈췄습니다",
        "",
        f"- 게시물: {pdir.parent.name}/{pdir.name}",
        f"- 멈춘 단계: **{entry['step_ko']}**",
        f"- 시각: {entry['at']}",
        "",
        "## 무슨 일이 있었나요",
        "",
        "```",
        entry["message"],
        "```",
        "",
    ]
    if entry.get("url"):
        lines += [f"- 그때 화면 주소: {entry['url']}", ""]
    if entry.get("screenshot"):
        lines += [f"- 화면 캡처: `{entry['screenshot']}`", ""]

    done = done_steps(pdir)
    lines += ["## 어디까지 했나요", "", "| 단계 | 상태 |", "|---|---|"]
    for s in STEPS:
        lines.append(f"| {STEP_KO[s]} | {'✓ 완료' if s in done else '– 아직'} |")

    lines += [
        "",
        "## 이제 무엇을 하면 되나요",
        "",
        entry.get("user_action") or "위 내용을 확인한 뒤 다시 실행해 주세요.",
        "",
        "다시 실행하면 **처음부터가 아니라 멈춘 곳부터** 이어서 합니다.",
        "이미 올린 이미지는 다시 올리지 않습니다.",
        "",
    ]
    return c.write_text(pdir / "publish" / "실패보고서.md", "\n".join(lines))
