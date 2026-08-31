# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller 설정 (Stage 11).

    윈도우에서:  pyinstaller 오락숏폼스튜디오.spec --noconfirm

**한 폴더(one-folder) 방식입니다.** 한 파일(.exe) 로 묶으면 켤 때마다
임시 폴더에 200MB 를 풀어놓느라 **처음 뜨는 데 10초 넘게 걸립니다.**
설치파일(Inno Setup)이 어차피 폴더를 만들어 주므로 한 폴더가 낫습니다.

**넣지 않는 것**
  · API 열쇠 · db.sqlite3 · credentials.dat · Logs  — 담당자 PC 에만 있습니다
  · imageio-ffmpeg           — 배포본은 공식 FFmpeg 빌드를 씁니다 (§8)
  · anthropic                — 기본 대본 공급자가 OpenAI 라서 뺐습니다
  · 안 쓰는 Qt 모듈           — 넣으면 설치파일이 세 배가 됩니다
"""

import sys
from pathlib import Path

SPECPATH = globals().get("SPECPATH", ".")
여기 = Path(SPECPATH).resolve()

APP_NAME = "오락숏폼스튜디오"

# ── 함께 넣을 파일 ────────────────────────────────────────
#
# `app/core/paths.py` 의 `_default_bundled_assets()` 가 sys._MEIPASS/assets 에서
# 찾습니다. 그래서 assets 폴더 이름을 그대로 유지해야 합니다.
datas = [
    (str(여기 / "assets" / "character_profile.json"), "assets"),
    (str(여기 / "assets" / "pricing.json"), "assets"),
    (str(여기 / "assets" / "subtitle_style.json"), "assets"),
]

# 담당자가 직접 넣는 것들 — 있으면 함께 넣고, 없으면 안내문만 넣습니다.
# **없다고 빌드가 실패하면 안 됩니다.** 글꼴·음원은 각자 받아서 넣습니다.
for 폴더 in ("master", "fonts", "bgm"):
    바탕 = 여기 / "assets" / 폴더
    if not 바탕.is_dir():
        continue
    for f in sorted(바탕.iterdir()):
        if f.is_file():
            datas.append((str(f), f"assets/{폴더}"))

# 공식 FFmpeg 빌드 (§8). 빌드 전에 ffmpeg\ 폴더에 넣어 두세요.
# 없으면 여기서 멈춥니다 — 없는 채로 만들면 담당자 PC 에서 영상이 안 만들어집니다.
# 이름은 만드는 곳에 따라 다릅니다. 리눅스에서 시험 삼아 만들어 볼 수 있게
# 두 이름을 다 봅니다. 배포본은 윈도우에서 만드니 ffmpeg.exe 가 들어갑니다.
ffmpeg_dir = 여기 / "ffmpeg"
ffmpeg_exe = next((ffmpeg_dir / n for n in ("ffmpeg.exe", "ffmpeg")
                   if (ffmpeg_dir / n).is_file()), None)
if ffmpeg_exe is not None:
    datas.append((str(ffmpeg_exe), "ffmpeg"))
    for 옆것 in sorted(ffmpeg_dir.glob("*.txt")) + sorted(ffmpeg_dir.glob("*.md")):
        datas.append((str(옆것), "ffmpeg"))     # 라이선스 문서를 함께 넣습니다
else:
    raise SystemExit(
        "\n[멈춤] ffmpeg\\ffmpeg.exe 가 없습니다.\n"
        "  공식 빌드를 받아 ffmpeg\\ 폴더에 넣고 다시 실행하세요.\n"
        "  넣지 않고 만들면 담당자 PC 에서 영상이 만들어지지 않습니다.\n"
        "  자세한 순서: 배포_만드는_법.md\n")

# ── 뺄 것 ────────────────────────────────────────────────
excludes = [
    # 배포본은 공식 FFmpeg 를 씁니다. 이걸 넣으면 ffmpeg 이 두 개가 됩니다.
    "imageio_ffmpeg", "imageio",
    # 기본 대본 공급자가 OpenAI 입니다.
    "anthropic",
    # 시험 도구는 담당자 PC 에 필요 없습니다.
    "pytest", "_pytest",
    # HTTPS 는 파이썬에 붙어 있는 ssl 로 충분합니다. 이것들은 requests 가
    # **선택적으로만** 쓰는 것이라 없어도 됩니다. 넣으면 크기만 커집니다.
    "cryptography", "OpenSSL", "pyOpenSSL", "urllib3.contrib.pyopenssl",
    # 안 쓰는 무거운 것들
    "tkinter", "matplotlib", "numpy", "pandas", "scipy",
    "IPython", "jupyter", "notebook",
    # 안 쓰는 Qt 모듈 — 넣으면 설치파일이 세 배가 됩니다
    "PySide6.QtWebEngineCore", "PySide6.QtWebEngineWidgets",
    "PySide6.QtWebEngineQuick", "PySide6.QtWebChannel",
    "PySide6.Qt3DCore", "PySide6.Qt3DRender", "PySide6.Qt3DInput",
    "PySide6.Qt3DLogic", "PySide6.Qt3DAnimation", "PySide6.Qt3DExtras",
    "PySide6.QtCharts", "PySide6.QtDataVisualization",
    "PySide6.QtMultimedia", "PySide6.QtMultimediaWidgets",
    "PySide6.QtQuick", "PySide6.QtQuick3D", "PySide6.QtQml",
    "PySide6.QtQuickWidgets", "PySide6.QtQuickControls2",
    "PySide6.QtBluetooth", "PySide6.QtNfc", "PySide6.QtPositioning",
    "PySide6.QtSerialPort", "PySide6.QtSerialBus",
    "PySide6.QtSql", "PySide6.QtTest", "PySide6.QtHelp",
    "PySide6.QtDesigner", "PySide6.QtUiTools",
    "PySide6.QtOpenGL", "PySide6.QtOpenGLWidgets",
    "PySide6.QtPdf", "PySide6.QtPdfWidgets",
    "PySide6.QtSpatialAudio", "PySide6.QtTextToSpeech",
    "PySide6.QtRemoteObjects", "PySide6.QtScxml", "PySide6.QtSensors",
    "PySide6.QtStateMachine", "PySide6.QtWebSockets",
    "shiboken6.QtCore",
]

hiddenimports = [
    # 늦게 부르는 것들 — PyInstaller 가 코드를 훑어서는 못 찾습니다.
    "requests",          # app/core/http.py 안에서 부릅니다
    "sqlite3",
    "PIL.Image", "PIL.ImageDraw", "PIL.ImageFont",
]

# 열쇠 금고는 **윈도우 전용**입니다. 리눅스에서 시험 삼아 만들 때
# 이 이름을 넣으면 「못 찾음」 오류가 납니다. 만드는 곳을 보고 넣습니다.
if sys.platform == "win32":
    hiddenimports += ["win32crypt", "win32api", "pywintypes"]

a = Analysis(
    ["app/main.py"],
    pathex=[str(여기)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=excludes,
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name=APP_NAME,
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,                 # UPX 는 백신이 자주 오탐합니다. 쓰지 않습니다.
    console=False,             # 검은 창이 같이 뜨면 안 됩니다
    disable_windowed_traceback=True,   # 오류 원문을 담당자 화면에 띄우지 않습니다 (§9)
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=str(여기 / "assets" / "오락이.ico")
         if (여기 / "assets" / "오락이.ico").is_file() else None,
    version=str(여기 / "version_info.txt")
            if (여기 / "version_info.txt").is_file() else None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name=APP_NAME,
)
