# -*- coding: utf-8 -*-
"""
화면 색과 글씨 크기 — 50~60대가 편하게 보시도록 크게 잡았습니다.

지키는 것
  · 기본 글씨 18px 이상, 버튼 글씨 19px 이상
  · 버튼 높이 52px 이상, 입력창 48px 이상
  · 밝은 바탕에 진한 글씨. 흐린 회색 글씨를 쓰지 않습니다.
  · 화면 배율 125%·150% 에서도 글자가 잘리지 않도록 여백을 넉넉히 둡니다.
"""
from __future__ import annotations

# ── 색 ──────────────────────────────────────────────────────
BG = "#FFFFFF"          # 바탕
PANEL = "#F4F7F5"       # 카드 바탕
INK = "#1A1D21"         # 본문 글씨 (아주 진하게)
SUB = "#41474D"         # 보조 글씨 — 흐린 회색을 쓰지 않습니다
LINE = "#C9D2CC"        # 테두리

PRIMARY = "#1F6F44"     # 주요 동작 (초록)
PRIMARY_DARK = "#17532F"
DANGER = "#B02A21"      # 지우기·취소
WARN = "#8A5B00"        # 확인 필요
OK = "#1F6F44"

# ── 크기 ────────────────────────────────────────────────────
FONT_BASE = 19          # 본문
FONT_MENU = 20          # 왼쪽 메뉴
FONT_BTN = 20           # 버튼
FONT_TITLE = 30         # 화면 제목
FONT_BIG = 40           # 홈 큰 숫자

BTN_H = 56              # 버튼 높이
INPUT_H = 50            # 입력창 높이
MENU_H = 62             # 메뉴 한 칸 높이

FAMILY = "'맑은 고딕', 'Malgun Gothic', 'Segoe UI', sans-serif"


def stylesheet() -> str:
    return f"""
* {{ font-family: {FAMILY}; }}

QWidget {{
    background: {BG};
    color: {INK};
    font-size: {FONT_BASE}px;
}}

/* ── 왼쪽 메뉴 ─────────────────────────────────── */
#SideBar {{ background: {PANEL}; border-right: 2px solid {LINE}; }}

#SideBar QPushButton {{
    background: transparent;
    color: {INK};
    border: none;
    border-radius: 10px;
    padding: 10px 16px;
    text-align: left;
    font-size: {FONT_MENU}px;
    min-height: {MENU_H}px;
}}
#SideBar QPushButton:hover {{ background: #E4EBE6; }}
#SideBar QPushButton:checked {{
    background: {PRIMARY};
    color: #FFFFFF;
    font-weight: bold;
}}

/* ── 제목 ──────────────────────────────────────── */
#Title {{ font-size: {FONT_TITLE}px; font-weight: bold; color: {INK}; }}
#Lead  {{ font-size: {FONT_BASE + 1}px; color: {SUB}; }}

/* ── 카드 ──────────────────────────────────────── */
#Card {{
    background: {PANEL};
    border: 2px solid {LINE};
    border-radius: 14px;
}}
#CardTitle {{ font-size: {FONT_BASE + 3}px; font-weight: bold; color: {INK}; }}
#CardBig   {{ font-size: {FONT_BIG}px; font-weight: bold; color: {PRIMARY}; }}

/* ── 버튼 ──────────────────────────────────────── */
QPushButton {{
    background: #FFFFFF;
    color: {INK};
    border: 2px solid {LINE};
    border-radius: 12px;
    padding: 12px 22px;
    font-size: {FONT_BTN}px;
    min-height: {BTN_H}px;
}}
QPushButton:hover  {{ background: #EEF3EF; }}
QPushButton:pressed {{ background: #E2EAE4; }}
QPushButton:disabled {{ color: #7A8288; border-color: #DDE3DF; background: #F7F9F8; }}

QPushButton#Primary {{
    background: {PRIMARY};
    color: #FFFFFF;
    border: 2px solid {PRIMARY};
    font-weight: bold;
}}
QPushButton#Primary:hover   {{ background: {PRIMARY_DARK}; border-color: {PRIMARY_DARK}; }}
QPushButton#Primary:disabled {{ background: #9FBFAD; border-color: #9FBFAD; color: #FFFFFF; }}

QPushButton#Danger {{
    background: #FFFFFF;
    color: {DANGER};
    border: 2px solid {DANGER};
    font-weight: bold;
}}
QPushButton#Danger:hover {{ background: #FBEDEC; }}

/* ── 입력 ──────────────────────────────────────── */
QLineEdit, QComboBox, QSpinBox, QTimeEdit {{
    background: #FFFFFF;
    border: 2px solid {LINE};
    border-radius: 10px;
    padding: 8px 14px;
    font-size: {FONT_BASE}px;
    min-height: {INPUT_H}px;
}}
QLineEdit:focus, QComboBox:focus, QSpinBox:focus, QTimeEdit:focus {{
    border-color: {PRIMARY};
}}
QComboBox::drop-down {{ width: 40px; border: none; }}
QComboBox QAbstractItemView {{
    font-size: {FONT_BASE}px;
    selection-background-color: {PRIMARY};
    selection-color: #FFFFFF;
}}

/* ── 목록·표 ───────────────────────────────────── */
QListWidget, QTableWidget, QTreeWidget {{
    background: #FFFFFF;
    border: 2px solid {LINE};
    border-radius: 12px;
    font-size: {FONT_BASE}px;
}}
QListWidget::item, QTableWidget::item {{ padding: 12px 10px; min-height: 34px; }}
QListWidget::item:selected, QTableWidget::item:selected {{
    background: {PRIMARY}; color: #FFFFFF;
}}
QHeaderView::section {{
    background: {PANEL};
    color: {INK};
    font-size: {FONT_BASE}px;
    font-weight: bold;
    padding: 12px 8px;
    border: none;
    border-bottom: 2px solid {LINE};
}}

/* ── 진행 표시 ─────────────────────────────────── */
QProgressBar {{
    background: #E8EDEA;
    border: none;
    border-radius: 10px;
    height: 22px;
    text-align: center;
    font-size: {FONT_BASE - 2}px;
    color: {INK};
}}
QProgressBar::chunk {{ background: {PRIMARY}; border-radius: 10px; }}

/* ── 작업 기록 창 ──────────────────────────────── */
QPlainTextEdit {{
    background: #FBFCFB;
    border: 2px solid {LINE};
    border-radius: 12px;
    font-family: 'Consolas', 'D2Coding', monospace;
    font-size: {FONT_BASE - 2}px;
    color: {INK};
}}

/* ── 스크롤 막대 (손가락으로도 잡히게 굵게) ───── */
QScrollBar:vertical {{ background: transparent; width: 18px; margin: 4px; }}
QScrollBar::handle:vertical {{ background: #B4C0B8; border-radius: 9px; min-height: 40px; }}
QScrollBar::handle:vertical:hover {{ background: #93A399; }}
QScrollBar::add-line, QScrollBar::sub-line {{ height: 0; }}

QMessageBox {{ font-size: {FONT_BASE}px; }}
QMessageBox QPushButton {{ min-width: 130px; }}

/* ── 탭 (발행 관리·글 상세) ────────────────────── */
QTabWidget::pane {{
    border: 2px solid {LINE};
    border-radius: 12px;
    background: #FFFFFF;
    top: -2px;
}}
QTabBar::tab {{
    background: {PANEL};
    color: {INK};
    font-size: {FONT_BTN}px;
    padding: 12px 26px;
    min-height: 30px;
    border: 2px solid {LINE};
    border-bottom: none;
    border-top-left-radius: 12px;
    border-top-right-radius: 12px;
    margin-right: 6px;
}}
QTabBar::tab:selected {{
    background: {PRIMARY};
    color: #FFFFFF;
    font-weight: bold;
    border-color: {PRIMARY};
}}

/* ── 체크 상자 ─────────────────────────────────── */
QCheckBox {{ font-size: {FONT_BASE}px; spacing: 12px; min-height: 44px; }}
QCheckBox::indicator {{
    width: 30px; height: 30px;
    border: 2px solid {LINE}; border-radius: 8px; background: #FFFFFF;
}}
QCheckBox::indicator:checked {{
    background: {PRIMARY}; border-color: {PRIMARY};
}}

/* ── 본문 미리보기 ─────────────────────────────── */
QTextBrowser {{
    background: #FFFFFF;
    border: 2px solid {LINE};
    border-radius: 12px;
    font-size: {FONT_BASE}px;
    padding: 10px;
}}

/* ── 좌우 나눔 손잡이 ──────────────────────────── */
QSplitter::handle {{ background: {LINE}; width: 6px; border-radius: 3px; }}

/* ── 하단 보조 메뉴 (조금 작게) ────────────────── */
#SideBar QPushButton[aux="true"] {{
    font-size: {FONT_BASE - 1}px;
    min-height: 48px;
    color: {SUB};
}}
#SideBar QPushButton[aux="true"]:checked {{
    background: {PRIMARY}; color: #FFFFFF; font-weight: bold;
}}

/* ── 위쪽 상태 띠 ──────────────────────────────── */
#TopStrip {{
    background: {PANEL};
    border-bottom: 2px solid {LINE};
}}
#TopStrip QLabel {{ font-size: {FONT_BASE - 1}px; color: {INK}; background: transparent; }}

/* ── 요약 카드 (성공·확인 필요·실패) ───────────── */
#SumOK, #SumWarn, #SumFail {{
    border-radius: 12px; padding: 10px 18px;
    font-size: {FONT_BASE + 1}px; font-weight: bold;
}}
#SumOK   {{ background: #E4F1E9; color: {OK}; border: 2px solid {OK}; }}
#SumWarn {{ background: #F7EEDD; color: {WARN}; border: 2px solid {WARN}; }}
#SumFail {{ background: #F9E8E6; color: {DANGER}; border: 2px solid {DANGER}; }}
"""
