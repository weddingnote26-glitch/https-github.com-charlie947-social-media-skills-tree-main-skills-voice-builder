# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller 설정 — 네이버 블로그 도우미

  · --noconsole 로 묶어 검은 콘솔 창이 뜨지 않게 합니다.
  · onedir 방식입니다. onefile 보다 켜지는 속도가 빠릅니다.
  · scripts/ 와 config/ 등 프로그램이 읽는 파일을 함께 넣습니다.
"""
from pathlib import Path

ROOT = Path(SPECPATH)

datas = [
    (str(ROOT / 'scripts'), 'scripts'),
    (str(ROOT / 'config'), 'config'),
    (str(ROOT / 'templates'), 'templates'),
]
for name in ('README.md', '회사PC_처음설치.md', '회사PC_실행방법.md',
             '회사PC_문제해결.md', '이미지_챗GPT_만드는법.md', 'icon.ico'):
    p = ROOT / name
    if p.exists():
        datas.append((str(p), '.'))

a = Analysis(
    ['app.py'],
    pathex=[str(ROOT)],
    binaries=[],
    datas=datas,
    hiddenimports=['yaml', 'dateutil', 'markdown', 'PIL'],
    hookspath=[],
    runtime_hooks=[],
    excludes=['tkinter', 'PySide6.QtWebEngineCore', 'PySide6.Qt3DCore',
              'PySide6.QtMultimedia', 'PySide6.QtQuick', 'PySide6.QtQml'],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz, a.scripts, [],
    exclude_binaries=True,
    name='네이버블로그도우미',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,               # ★ 검은 콘솔 창을 띄우지 않습니다
    disable_windowed_traceback=False,
    icon=str(ROOT / 'icon.ico') if (ROOT / 'icon.ico').exists() else None,
)

coll = COLLECT(
    exe, a.binaries, a.datas,
    strip=False, upx=False,
    name='네이버블로그도우미',
)
