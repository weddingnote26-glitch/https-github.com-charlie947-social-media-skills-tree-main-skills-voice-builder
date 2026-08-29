"""배포본 만들기 시험 — Stage 11.

**여기서는 윈도우용 EXE 를 만들 수 없습니다.** PyInstaller 는 자기가 도는
운영체제용만 만들고, Inno Setup 은 윈도우 전용입니다. 그래서 이 시험은
**설정이 맞는지**를 봅니다 — 실제 EXE 는 윈도우에서 `빌드.ps1` 이 만듭니다.

가장 중요한 것: **프로그램이 실행 중에 읽는 파일이 배포본에 다 들어가는가.**
하나라도 빠지면 담당자 PC 에서 그때 가서 죽습니다.

    python tests/test_packaging.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

바탕 = Path(__file__).resolve().parent.parent
SPEC = 바탕 / "오락숏폼스튜디오.spec"
ISS = 바탕 / "설치파일.iss"
BUILD = 바탕 / "빌드.ps1"
VERSION = 바탕 / "version_info.txt"
GUIDE = 바탕 / "배포_만드는_법.md"


def _spec() -> str:
    return SPEC.read_text(encoding="utf-8")


def _iss() -> str:
    return ISS.read_text(encoding="utf-8")


# ── 파일이 다 있는가 ─────────────────────────────────────


def test_배포에_필요한_파일이_다_있다() -> None:
    for f in (SPEC, ISS, BUILD, VERSION, GUIDE):
        assert f.is_file(), f"{f.name} 이 없습니다"


def test_설정_파일이_파이썬으로_읽힌다() -> None:
    import ast
    ast.parse(_spec())


# ── 실행 중에 읽는 파일이 다 들어가는가 (제일 중요) ──────


def test_프로그램이_읽는_자산이_전부_들어간다() -> None:
    """코드에서 파일 이름을 긁어내 설정과 맞춰 봅니다.

    새 설정 파일을 만들고 여기 넣는 걸 잊으면 담당자 PC 에서만 죽습니다.
    그때는 이미 늦습니다.
    """
    읽는것: set[str] = set()
    for py in (바탕 / "app").rglob("*.py"):
        글 = py.read_text(encoding="utf-8")
        # `"pricing.json"` 처럼 코드 안에 적힌 파일 이름.
        # **한글 이름도 잡습니다** — `"새설정.json"` 을 놓치면 이 시험이
        # 있으나 마나입니다. (실제로 놓쳐서 넓혔습니다)
        for m in re.finditer(r'"([^"/\\:*?<>|]+\.(?:json|ttf|otf|ico))"', 글):
            읽는것.add(m.group(1))

    spec = _spec()
    빠진것 = [이름 for 이름 in 읽는것 if 이름 not in spec]
    # 시스템 글꼴은 담당자 PC 것을 쓰므로 넣지 않습니다
    빠진것 = [n for n in 빠진것 if n not in ("malgun.ttf", "wqy-zenhei.ttc")]
    assert not 빠진것, f"코드가 읽는데 배포본에 안 들어가는 파일: {빠진것}"


def test_설정에_적힌_자산이_실제로_있다() -> None:
    """반대 방향. 없는 파일을 넣으라고 하면 만들기가 실패합니다."""
    for 이름 in re.findall(r'"assets" / "([^"]+)"', _spec()):
        f = 바탕 / "assets" / 이름
        if 이름.endswith(".ico"):
            continue          # 아이콘은 있으면 쓰고 없으면 넘어갑니다
        assert f.is_file(), f"assets/{이름} 이 없습니다"


def test_담당자가_넣는_폴더_세_개를_긁어_담는다() -> None:
    spec = _spec()
    for 폴더 in ("master", "fonts", "bgm"):
        assert f'"{폴더}"' in spec, f"{폴더} 폴더를 안 담습니다"
    assert "if not 바탕.is_dir():" in spec or "is_dir()" in spec, \
        "폴더가 없을 때 넘어가지 않으면 만들기가 실패합니다"


# ── FFmpeg (§8) ─────────────────────────────────────────


def test_FFmpeg가_없으면_만들기가_멈춘다() -> None:
    """없는 채로 만들면 담당자 PC 에서 영상이 안 만들어집니다."""
    spec = _spec()
    assert "SystemExit" in spec, "FFmpeg 이 없어도 그냥 만들어집니다"
    자리 = spec.index("ffmpeg_exe")
    assert "raise SystemExit" in spec[자리:], "멈추라는 코드가 없습니다"


def test_동봉_FFmpeg를_먼저_찾는다() -> None:
    """배포본은 **공식 빌드**를 씁니다 (§8). 개발용을 넣으면 안 됩니다."""
    from app.core import ffmpeg as mod

    글 = Path(mod.__file__).read_text(encoding="utf-8")
    동봉 = 글.index("_MEIPASS")
    개발용 = 글.index("imageio_ffmpeg")
    assert 동봉 < 개발용, "개발용 FFmpeg 을 동봉본보다 먼저 찾습니다"

    spec = _spec()
    assert '"imageio_ffmpeg"' in spec, "개발용 FFmpeg 을 빼지 않았습니다"
    빼는곳 = spec.index("excludes = [")
    assert spec.index('"imageio_ffmpeg"') > 빼는곳, "빼는 목록에 있어야 합니다"


def test_FFmpeg_이름을_두_가지로_찾는다() -> None:
    """윈도우는 ffmpeg.exe, 리눅스는 ffmpeg. 시험 삼아 만들어 볼 수 있게."""
    spec = _spec()
    assert '"ffmpeg.exe", "ffmpeg"' in spec or '"ffmpeg.exe"' in spec


# ── 담당자 화면에 개발자 말이 안 나오게 (§9) ─────────────


def test_검은_창이_같이_뜨지_않는다() -> None:
    assert "console=False" in _spec(), "검은 명령창이 같이 뜹니다"


def test_오류_원문을_화면에_띄우지_않는다() -> None:
    """§9 — 파이썬 오류 창이 담당자에게 뜨면 안 됩니다."""
    assert "disable_windowed_traceback=True" in _spec()


# ── 크기와 백신 ─────────────────────────────────────────


def test_압축도구를_쓰지_않는다() -> None:
    """UPX 는 백신이 자주 오탐합니다. 지워지면 담당자가 손쓸 수 없습니다."""
    spec = _spec()
    assert "upx=False" in spec
    assert "upx=True" not in spec


def test_안_쓰는_Qt_모듈을_뺀다() -> None:
    """다 넣으면 설치파일이 세 배가 됩니다."""
    spec = _spec()
    for 무거운것 in ("QtWebEngineCore", "Qt3DCore", "QtQuick", "QtMultimedia",
                  "QtCharts"):
        assert 무거운것 in spec, f"{무거운것} 를 안 뺐습니다"


def test_안_쓰는_꾸러미를_뺀다() -> None:
    spec = _spec()
    for 이름 in ("pytest", "tkinter", "matplotlib", "numpy"):
        assert f'"{이름}"' in spec, f"{이름} 를 안 뺐습니다"


def test_쓰는_것은_빼지_않는다() -> None:
    """실수로 필요한 걸 빼면 담당자 PC 에서 그때 죽습니다."""
    spec = _spec()
    빼는곳 = spec[spec.index("excludes = ["):spec.index("hiddenimports = [")]
    for 꼭필요 in ('"PySide6"', '"PIL"', '"requests"', '"sqlite3"', '"json"'):
        assert 꼭필요 not in 빼는곳, f"{꼭필요} 를 빼면 안 됩니다"


def test_늦게_부르는_것을_찾아_넣는다() -> None:
    """`import` 를 함수 안에서 하면 PyInstaller 가 못 찾습니다."""
    spec = _spec()
    자리 = spec.index("hiddenimports = [")
    뒤 = spec[자리:]
    for 이름 in ('"requests"', '"sqlite3"', '"PIL.Image"'):
        assert 이름 in 뒤, f"{이름} 를 안 넣었습니다"
    # 윈도우 전용은 만드는 곳을 보고 넣습니다
    assert 'sys.platform == "win32"' in 뒤, "win32crypt 를 조건 없이 넣습니다"
    assert '"win32crypt"' in 뒤


# ── 설치파일 (§0-1 4번) ─────────────────────────────────


def test_지워도_담당자_영상이_남는다() -> None:
    """**이게 제일 중요합니다.** 지우기가 영상을 지우면 안 됩니다 (§0-1 4번)."""
    글 = _iss()
    절 = re.findall(r"^\[(\w+)\]", 글, re.M)
    assert "UninstallDelete" not in 절, (
        "[UninstallDelete] 절이 있습니다 — 담당자가 만든 영상이 지워질 수 있습니다")
    assert "내 문서" in 글, "지운 뒤 영상이 어디 있는지 안 알려줍니다"


def test_관리자_비밀번호를_묻지_않는다() -> None:
    """담당자는 회사 계정이라 관리자 비밀번호를 모를 수 있습니다."""
    assert "PrivilegesRequired=lowest" in _iss()


def test_설치파일이_한국어로_뜬다() -> None:
    글 = _iss()
    assert "Korean.isl" in 글
    assert "ShowLanguageDialog=no" in 글, "언어를 또 물어봅니다"


def test_설치파일이_만든_폴더_이름과_맞는다() -> None:
    """설정의 이름과 설치파일이 찾는 폴더가 다르면 「파일 없음」 이 납니다."""
    spec_name = re.search(r'APP_NAME = "([^"]+)"', _spec()).group(1)
    assert f'#define AppDir "{spec_name}"' in _iss(), \
        f"설정은 「{spec_name}」 인데 설치파일은 다른 이름을 찾습니다"
    assert f'Source: "dist\\{{#AppDir}}\\*"' in _iss()


def test_판_번호가_서로_맞는다() -> None:
    iss = re.search(r'#define AppVersion "([\d.]+)"', _iss()).group(1)
    ver = VERSION.read_text(encoding="utf-8")
    assert f"'{iss}'" in ver, f"설치파일은 {iss} 인데 파일 속성은 다릅니다"


def test_64비트만_받는다() -> None:
    assert "ArchitecturesAllowed=x64compatible" in _iss()


# ── 빌드 스크립트 ───────────────────────────────────────


def test_시험이_실패하면_배포본을_안_만든다() -> None:
    """**설명 주석이 아니라 진짜 실행하는 줄**을 봅니다."""
    글 = BUILD.read_text(encoding="utf-8")
    코드 = "\n".join(l for l in 글.splitlines() if not l.lstrip().startswith("#"))
    assert "0개 실패" in 코드, "시험 결과를 안 봅니다"
    시험자리 = 코드.index("0개 실패")
    만들기 = re.search(r"& \$파이썬 -m PyInstaller", 코드)
    assert 만들기, "PyInstaller 를 부르는 줄을 못 찾았습니다"
    assert 시험자리 < 만들기.start(), "시험을 돌리기 전에 만들어 버립니다"
    # 실패하면 진짜로 멈추는지
    자리 = 코드.index("0개 실패")
    assert "멈춤" in 코드[자리:자리 + 300], "시험이 실패해도 계속 만듭니다"


def test_만든_뒤_진짜_켜지는지_본다() -> None:
    """켜자마자 꺼지는 배포본을 담당자에게 주면 안 됩니다."""
    글 = BUILD.read_text(encoding="utf-8")
    assert "HasExited" in 글, "켜지는지 확인하지 않습니다"
    assert "Start-Sleep" in 글


def test_비밀이_섞였는지_본다() -> None:
    글 = BUILD.read_text(encoding="utf-8")
    for 위험 in ("sqlite3", "credentials.dat", ".env"):
        assert 위험 in 글, f"{위험} 가 섞였는지 확인하지 않습니다"


def test_FFmpeg가_없으면_빌드가_멈춘다() -> None:
    글 = BUILD.read_text(encoding="utf-8")
    assert "ffmpeg.exe" in 글
    자리 = 글.index("ffmpeg.exe")
    assert "멈춤" in 글[자리:자리 + 400], "FFmpeg 없이도 그냥 만듭니다"


# ── 안전 ────────────────────────────────────────────────


def test_배포본에_비밀_파일을_안_넣는다() -> None:
    """**설명글이 아니라 실제로 담는 목록을 봅니다.**

    설명글에 「credentials.dat 는 안 넣습니다」 라고 써 놓고 실제로는
    넣고 있을 수 있습니다. 글자만 훑으면 그걸 못 잡습니다.
    """
    spec = _spec()
    담는줄 = [l for l in spec.splitlines()
            if "datas.append" in l or l.strip().startswith('(str(여기')]
    담는글 = "\n".join(담는줄)
    assert 담는글, "담는 목록을 못 찾았습니다 — 시험을 고쳐야 합니다"
    for 위험 in ("credentials", ".env", "sqlite3", "Logs", "Settings"):
        assert 위험 not in 담는글, f"{위험} 를 배포본에 넣습니다: {담는글}"

    # 실제로 만든 배포본이 있으면 거기까지 봅니다
    나온것 = 바탕 / "dist"
    if 나온것.is_dir():
        샌것 = [str(f) for f in 나온것.rglob("*")
              if f.is_file() and (f.suffix in (".sqlite3", ".env", ".log")
                                  or f.name == "credentials.dat")]
        assert not 샌것, f"만든 배포본에 비밀 파일이 있습니다: {샌것[:3]}"


def test_설정에_지우는_코드가_없다() -> None:
    for f in (SPEC, BUILD):
        글 = f.read_text(encoding="utf-8")
        for 금지 in ("rmtree", "os.remove", "Remove-Item C:", "rm -rf",
                   "내 문서", "Documents"):
            if 금지 in ("내 문서", "Documents") and f is BUILD:
                assert 금지 not in 글, f"{f.name} 이 담당자 자료 폴더를 건드립니다"
            elif 금지 not in ("내 문서", "Documents"):
                assert 금지 not in 글 or f is BUILD, f"{f.name} 에 {금지} 가 있습니다"


def test_빌드가_지우는_것은_만들어낸_것뿐이다() -> None:
    """`dist` `build` 만 지웁니다. 담당자 자료는 안 건드립니다."""
    글 = BUILD.read_text(encoding="utf-8")
    for m in re.finditer(r'Remove-Item "([^"]+)"', 글):
        대상 = m.group(1)
        assert 대상 in (".\\dist", ".\\build"), f"{대상} 을 지웁니다"


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
