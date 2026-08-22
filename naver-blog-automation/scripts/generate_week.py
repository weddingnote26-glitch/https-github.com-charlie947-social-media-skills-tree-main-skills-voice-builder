# -*- coding: utf-8 -*-
"""
원고 생성 — 편성된 자리에 실제 글을 씁니다.

두 가지 방식이 있습니다. config/settings.yaml 의 generation.mode 로 고릅니다.

  claude_code (기본값·권장)
      원고 작성 지시서(brief.md)를 모아 작업 지시 파일을 만듭니다.
      Claude Code에게 "이번 주 원고 써줘" 라고 말하면 그 파일을 보고 씁니다.
      API 키가 필요 없고 추가 비용이 들지 않습니다.

  api
      Claude API를 직접 불러 원고를 자동으로 씁니다.
      환경변수 ANTHROPIC_API_KEY 가 필요합니다.

실행:  python scripts/generate_week.py [--week 2026-W36] [--only coin] [--date 2026-08-25]
"""
from __future__ import annotations

import argparse
import datetime as dt
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts import common as c  # noqa: E402

WORK_ORDER_NAME = "작업지시_이번주원고.md"


# ──────────────────────────────────────────────────────────────
def find_pending(wdir: Path, only_channel: str | None,
                 only_date: str | None) -> list[Path]:
    """아직 post.md 가 없는 게시물 폴더를 찾습니다."""
    pending = []
    for ch_dir in sorted(p for p in wdir.iterdir() if p.is_dir()):
        if only_channel and ch_dir.name != only_channel:
            continue
        for day_dir in sorted(p for p in ch_dir.iterdir() if p.is_dir()):
            if only_date and day_dir.name != only_date:
                continue
            if (day_dir / "brief.md").exists() and not (day_dir / "post.md").exists():
                pending.append(day_dir)
    return pending


def resolve_week(week: str | None) -> Path:
    if week:
        wdir = c.week_dir(week.upper())
        if not wdir.exists():
            raise SystemExit(
                f"{week} 주차 폴더가 없습니다.\n"
                f"  먼저 편성을 만들어 주세요: python scripts/schedule_week.py --week {week}"
            )
        return wdir
    # 주차를 안 주면 가장 최근에 만든 주차를 씁니다.
    weeks = sorted((p for p in c.OUTPUT_DIR.iterdir() if p.is_dir() and p.name[:2] == "20"),
                   key=lambda p: p.name)
    if not weeks:
        raise SystemExit(
            "만들어진 주차가 없습니다.\n"
            "  먼저 편성을 만들어 주세요: python scripts/schedule_week.py"
        )
    return weeks[-1]


# ──────────────────────────────────────────────────────────────
# 방식 1 — Claude Code 연동 (기본값)
# ──────────────────────────────────────────────────────────────
def mode_claude_code(wdir: Path, pending: list[Path]) -> None:
    lines = [
        f"# 이번 주 원고 작업 지시 — {wdir.name}",
        "",
        "> **Claude Code에게 이렇게 말하세요:**",
        "> ```",
        f"> {c.rel(wdir / WORK_ORDER_NAME)} 를 읽고 이번 주 원고를 순서대로 써줘",
        "> ```",
        "",
        "---",
        "",
        "## 작성할 글 목록",
        "",
        "| # | 채널 | 발행일 | 슬롯 | 지시서 | 저장 위치 |",
        "|---|---|---|---|---|---|",
    ]
    for i, pdir in enumerate(pending, 1):
        ch_key = pdir.parent.name
        ch = c.get_channel(ch_key)
        date = dt.date.fromisoformat(pdir.name)
        meta = c.read_yaml(pdir / "metadata.yaml", default={}) or {}
        lines.append(
            f"| {i} | {ch['name']} | {date} ({c.weekday_ko(date)}) "
            f"| {meta.get('slot','')} | `{c.rel(pdir / 'brief.md')}` | `{c.rel(pdir)}` |"
        )

    lines += [
        "",
        "---",
        "",
        "## 반드시 지킬 것",
        "",
        "1. 글 하나마다 그 폴더의 **`brief.md` 를 먼저 읽고** 시작합니다.",
        "2. `templates/post_template.md` 의 형식(앞머리 메타데이터 + 본문)을 따릅니다.",
        "3. 두 채널에 **같은 소재나 같은 문장을 쓰지 않습니다.**",
        "4. 기존 블로그 글의 문장을 그대로 옮기지 않습니다. 새로 씁니다.",
        "5. 확인되지 않은 수치는 지어내지 말고 **`확인 필요`** 로 적습니다.",
        "6. 시황·뉴스 글에는 **자료 기준 시각(한국시간)** 을 반드시 넣습니다.",
        "7. 채널마다 정해진 **투자 유의 문구**를 빠뜨리지 않습니다.",
        "8. 글 하나를 끝낼 때마다 `post.md`, `sources.md`, `image_prompts.md` 를 만듭니다.",
        "",
        "## 다 쓴 뒤에",
        "",
        "```",
        "python scripts/review.py          # 검수",
        "python scripts/prepare_publish.py # 네이버 예약 발행 준비",
        "```",
        "",
    ]

    # 양식 미분석 경고
    unanalyzed = [k for k in ("coin", "stock")
                  if c.style_status(k).get("status") != "analyzed"]
    if unanalyzed:
        names = ", ".join(c.get_channel(k)["name"] for k in unanalyzed)
        lines[6:6] = [
            "> ⚠ **주의: 아직 글 양식이 분석되지 않은 채널이 있습니다.**",
            f"> {names}",
            ">",
            "> 실제 블로그 글을 확인하지 못한 상태입니다.",
            "> 기존 양식을 **지어내지 말고**, 임시 골격으로 쓴 뒤",
            "> 샘플을 받으면 다시 다듬어야 합니다.",
            "",
        ]

    path = c.write_text(wdir / WORK_ORDER_NAME, "\n".join(lines))

    c.say()
    c.ok(f"작업 지시 파일을 만들었습니다: {c.rel(path)}")
    c.say()
    c.say("  ┌─────────────────────────────────────────────────────┐")
    c.say("  │  이제 Claude Code에게 아래 문장을 그대로 말하세요.  │")
    c.say("  └─────────────────────────────────────────────────────┘")
    c.say()
    c.say(f"    {c.rel(path)} 를 읽고 이번 주 원고를 순서대로 써줘")
    c.say()


# ──────────────────────────────────────────────────────────────
# 방식 2 — Claude API 직접 호출
# ──────────────────────────────────────────────────────────────
SYSTEM_PROMPT = """당신은 네이버 블로그 편집자입니다.
주어진 '원고 작성 지시서'를 그대로 따라 한국어 블로그 원고를 씁니다.

반드시 지킬 것:
- 지시서에 적힌 채널의 문체 규칙과 금지 표현을 지킵니다.
- 확인되지 않은 수치는 절대 지어내지 않습니다. `확인 필요` 라고 적습니다.
- 미래 가격이나 수익률을 단정하지 않습니다.
- 매수·매도를 권유하거나 수익을 보장하는 표현을 쓰지 않습니다.
- 지시서에 적힌 투자 유의 문구를 글 끝에 그대로 넣습니다.
- 다른 블로그의 문장을 옮기지 않고 새로 씁니다.

출력 형식:
- 아무 설명도 덧붙이지 말고, 완성된 원고 파일 내용만 출력합니다.
- 파일은 `---` 로 둘러싼 앞머리 메타데이터로 시작하고, 그 아래에 본문을 씁니다.
- 앞머리에는 title_candidates(3개), title, keywords, hashtags, images, data_asof 를 채웁니다.
"""


def build_user_prompt(pdir: Path) -> str:
    brief = c.read_text(pdir / "brief.md")
    template = c.read_text(c.TEMPLATE_DIR / "post_template.md")
    ch_key = pdir.parent.name
    style_path = c.PROJECT_ROOT / c.get_channel(ch_key).get(
        "style_file", f"config/style_{ch_key}.md")
    style = c.read_text(style_path) if style_path.exists() else "(양식 분석 파일 없음)"

    return (
        "# 원고 작성 지시서\n\n"
        f"{brief}\n\n"
        "---\n\n"
        "# 채널 양식 참고 자료\n\n"
        f"{style}\n\n"
        "---\n\n"
        "# 따라야 할 파일 형식\n\n"
        "```markdown\n"
        f"{template}\n"
        "```\n\n"
        "위 형식의 `{{...}}` 자리를 실제 내용으로 채운 완성본만 출력하세요."
    )


def mode_api(wdir: Path, pending: list[Path], settings: dict) -> None:
    import os

    try:
        import anthropic
    except ImportError:
        c.error(
            "anthropic 패키지가 설치되어 있지 않습니다.\n"
            "      설치:  pip install anthropic\n"
            "      또는 config/settings.yaml 에서 generation.mode 를 claude_code 로 바꾸세요."
        )
        raise SystemExit(1)

    api_cfg = (settings.get("generation") or {}).get("api") or {}
    key_env = api_cfg.get("api_key_env", "ANTHROPIC_API_KEY")
    if not os.environ.get(key_env):
        c.error(
            f"환경변수 {key_env} 가 설정되어 있지 않습니다.\n"
            f"      PowerShell:  $env:{key_env} = \"발급받은키\"\n"
            f"      또는 config/settings.yaml 에서 generation.mode 를 claude_code 로 바꾸세요."
        )
        raise SystemExit(1)

    model = api_cfg.get("model", "claude-opus-5")
    max_tokens = int(api_cfg.get("max_tokens", 32000))
    client = anthropic.Anthropic()

    c.info(f"모델: {model}")
    written, failed = 0, 0

    for i, pdir in enumerate(pending, 1):
        pid = pdir.parent.name + "-" + pdir.name
        c.say(f"  ({i}/{len(pending)}) {pid} 작성 중 …")
        try:
            # 긴 글이므로 스트리밍으로 받습니다. (요청 시간 초과 방지)
            with client.messages.stream(
                model=model,
                max_tokens=max_tokens,
                thinking={"type": "adaptive"},
                system=SYSTEM_PROMPT,
                messages=[{"role": "user", "content": build_user_prompt(pdir)}],
            ) as stream:
                message = stream.get_final_message()

            if message.stop_reason == "refusal":
                c.warn(f"{pid} — 모델이 응답을 거절했습니다. 지시서를 확인해 주세요.")
                failed += 1
                continue

            text = "".join(b.text for b in message.content if b.type == "text").strip()
            if not text.startswith("---"):
                c.warn(f"{pid} — 형식이 예상과 달라 저장하지 않았습니다. 다시 시도해 주세요.")
                failed += 1
                continue

            c.write_text(pdir / "post.md", text + "\n")
            c.ok(f"{pid} 저장했습니다.")
            written += 1

        except anthropic.NotFoundError as e:
            c.error(f"모델을 찾을 수 없습니다({model}): {e}")
            raise SystemExit(1)
        except anthropic.AuthenticationError:
            c.error(f"{key_env} 값이 올바르지 않습니다.")
            raise SystemExit(1)
        except anthropic.RateLimitError:
            c.warn(f"{pid} — 요청이 몰려 잠시 제한됐습니다. 나중에 다시 실행해 주세요.")
            failed += 1
        except anthropic.APIStatusError as e:
            c.warn(f"{pid} — API 오류({e.status_code}). 건너뜁니다.")
            failed += 1
        except anthropic.APIConnectionError:
            c.warn(f"{pid} — 인터넷 연결 문제로 실패했습니다.")
            failed += 1

    c.say()
    c.ok(f"원고 {written}편을 저장했습니다. (실패 {failed}편)")
    if written:
        c.say()
        c.say("  다음 단계:  python scripts/review.py")


# ──────────────────────────────────────────────────────────────
def main() -> None:
    ap = argparse.ArgumentParser(description="원고를 생성합니다.")
    ap.add_argument("--week", help="주차 (예: 2026-W36). 생략하면 가장 최근 주차.")
    ap.add_argument("--only", choices=["coin", "stock"], help="한 채널만")
    ap.add_argument("--date", help="특정 날짜만 (YYYY-MM-DD)")
    args = ap.parse_args()

    try:
        settings = c.load_settings()
    except c.ConfigError as e:
        c.error(str(e))
        raise SystemExit(1)

    wdir = resolve_week(args.week)
    pending = find_pending(wdir, args.only, args.date)

    c.header(f"{wdir.name} 원고 생성")

    if not pending:
        c.ok("새로 쓸 원고가 없습니다. 모든 자리에 이미 원고가 있습니다.")
        c.say()
        c.say("  특정 글을 다시 쓰려면 그 폴더의 post.md 를 지운 뒤 다시 실행하세요.")
        return

    c.info(f"작성할 글: {len(pending)}편")

    mode = ((settings.get("generation") or {}).get("mode") or "claude_code").lower()
    if mode == "api":
        mode_api(wdir, pending, settings)
    else:
        mode_claude_code(wdir, pending)

    c.get_logger().info(f"원고 생성({mode}) {wdir.name}: 대상 {len(pending)}편")


if __name__ == "__main__":
    main()
