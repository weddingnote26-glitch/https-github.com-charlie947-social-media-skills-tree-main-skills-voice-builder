# -*- coding: utf-8 -*-
"""
화면 색과 글씨 크기 — 40~60대 PC 사용자 기준.

크기 체계 (8px 단위)
  · 기본 글씨 17px, 보조 설명 15px, 화면 제목 22px
  · 주요 버튼 46px, 보조 버튼 42px, 입력창 44px (클릭 영역 40px 이상)
  · 명도 대비 4.5:1 이상, 흐린 회색 글씨 금지
  · 배율 100/125/150% 에서 글자가 잘리지 않도록 여백 확보
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
FONT_BASE = 17          # 본문·입력 내용
FONT_SUB = 15           # 보조 설명
FONT_MENU = 18          # 왼쪽 메뉴
FONT_BTN = 17           # 주요 버튼
FONT_BTN_SM = 16        # 보조 버튼
FONT_TITLE = 22         # 화면 제목
FONT_BIG = 32           # 큰 숫자

BTN_H = 46              # 주요 버튼 높이
BTN_H_SM = 42           # 보조 버튼 높이
INPUT_H = 44            # 입력창 높이
MENU_H = 50             # 메뉴 한 칸 높이

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
    padding: 8px 14px;
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
#Lead  {{ font-size: {FONT_SUB}px; color: {SUB}; }}

/* ── 카드 ──────────────────────────────────────── */
#Card {{
    background: {PANEL};
    border: 2px solid {LINE};
    border-radius: 12px;
}}
#CardTitle {{ font-size: {FONT_BASE + 2}px; font-weight: bold; color: {INK}; }}
#CardBig   {{ font-size: {FONT_BIG}px; font-weight: bold; color: {PRIMARY}; }}

/* 입력창 위 작은 제목 */
#FieldLabel {{ font-size: {FONT_SUB + 1}px; font-weight: bold; color: {INK}; }}

/* ── 버튼 ──────────────────────────────────────── */
QPushButton {{
    background: #FFFFFF;
    color: {INK};
    border: 2px solid {LINE};
    border-radius: 10px;
    padding: 8px 20px;
    font-size: {FONT_BTN}px;
    min-height: {BTN_H}px;
}}
QPushButton:hover  {{ background: #EEF3EF; }}
QPushButton:pressed {{ background: #E2EAE4; }}
QPushButton:disabled {{ color: #7A8288; border-color: #DDE3DF; background: #F7F9F8; }}
QPushButton:focus {{ border-color: {PRIMARY}; }}

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

/* 보조 버튼 — 조금 낮고 글씨도 한 단계 작게 */
QPushButton[small="true"] {{
    min-height: {BTN_H_SM}px;
    font-size: {FONT_BTN_SM}px;
    padding: 6px 16px;
}}

/* ── 입력 ──────────────────────────────────────── */
QLineEdit, QComboBox, QSpinBox, QTimeEdit {{
    background: #FFFFFF;
    border: 2px solid {LINE};
    border-radius: 10px;
    padding: 6px 12px;
    font-size: {FONT_BASE}px;
    min-height: {INPUT_H}px;
}}
QLineEdit:focus, QComboBox:focus, QSpinBox:focus, QTimeEdit:focus {{
    border-color: {PRIMARY};
}}
QComboBox::drop-down {{ width: 36px; border: none; }}
QComboBox QAbstractItemView {{
    font-size: {FONT_BASE}px;
    selection-background-color: {PRIMARY};
    selection-color: #FFFFFF;
}}

/* ── 목록·표 ───────────────────────────────────── */
QListWidget, QTableWidget, QTreeWidget {{
    background: #FFFFFF;
    border: 2px solid {LINE};
    border-radius: 10px;
    font-size: {FONT_BASE - 1}px;
}}
QListWidget::item, QTableWidget::item {{ padding: 8px; min-height: 30px; }}
QListWidget::item:selected, QTableWidget::item:selected {{
    background: {PRIMARY}; color: #FFFFFF;
}}
QHeaderView::section {{
    background: {PANEL};
    color: {INK};
    font-size: {FONT_SUB + 1}px;
    font-weight: bold;
    padding: 10px 8px;
    border: none;
    border-bottom: 2px solid {LINE};
}}

/* ── 진행 표시 ─────────────────────────────────── */
QProgressBar {{
    background: #E8EDEA;
    border: none;
    border-radius: 9px;
    height: 18px;
    text-align: center;
    font-size: {FONT_SUB - 1}px;
    color: {INK};
}}
QProgressBar::chunk {{ background: {PRIMARY}; border-radius: 9px; }}

/* ── 작업 기록 창 (로그) ───────────────────────── */
QPlainTextEdit {{
    background: #FBFCFB;
    border: 2px solid {LINE};
    border-radius: 10px;
    font-family: 'Consolas', 'D2Coding', monospace;
    font-size: {FONT_SUB - 1}px;
    color: {INK};
}}
/* 본문 편집창 — 로그와 달리 본문 글꼴·크기 */
QPlainTextEdit#BodyEdit {{
    background: #FFFFFF;
    font-family: {FAMILY};
    font-size: {FONT_BASE}px;
}}

/* ── 스크롤 막대 ───────────────────────────────── */
QScrollBar:vertical {{ background: transparent; width: 16px; margin: 4px; }}
QScrollBar::handle:vertical {{ background: #B4C0B8; border-radius: 8px; min-height: 40px; }}
QScrollBar::handle:vertical:hover {{ background: #93A399; }}
QScrollBar::add-line, QScrollBar::sub-line {{ height: 0; }}

QMessageBox {{ font-size: {FONT_BASE}px; }}
QMessageBox QPushButton {{ min-width: 120px; }}

/* ── 탭 (발행 관리·글 상세) ────────────────────── */
QTabWidget::pane {{
    border: 2px solid {LINE};
    border-radius: 10px;
    background: #FFFFFF;
    top: -2px;
}}
QTabBar::tab {{
    background: {PANEL};
    color: {INK};
    font-size: {FONT_BTN_SM}px;
    padding: 8px 20px;
    min-height: 26px;
    border: 2px solid {LINE};
    border-bottom: none;
    border-top-left-radius: 10px;
    border-top-right-radius: 10px;
    margin-right: 4px;
}}
QTabBar::tab:selected {{
    background: {PRIMARY};
    color: #FFFFFF;
    font-weight: bold;
    border-color: {PRIMARY};
}}

/* ── 체크 상자 ─────────────────────────────────── */
QCheckBox {{ font-size: {FONT_BASE}px; spacing: 10px; min-height: 40px; }}
QCheckBox::indicator {{
    width: 26px; height: 26px;
    border: 2px solid {LINE}; border-radius: 7px; background: #FFFFFF;
}}
QCheckBox::indicator:checked {{
    background: {PRIMARY}; border-color: {PRIMARY};
}}

/* ── 본문 미리보기 ─────────────────────────────── */
QTextBrowser {{
    background: #FFFFFF;
    border: 2px solid {LINE};
    border-radius: 10px;
    font-size: {FONT_BASE}px;
    padding: 8px;
}}

/* ── 좌우 나눔 손잡이 ──────────────────────────── */
QSplitter::handle {{ background: {LINE}; width: 6px; border-radius: 3px; }}

/* ── 하단 보조 메뉴 (조금 작게) ────────────────── */
#SideBar QPushButton[aux="true"] {{
    font-size: {FONT_BASE - 1}px;
    min-height: 44px;
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
#TopStrip QLabel {{ font-size: {FONT_SUB + 1}px; color: {INK}; background: transparent; }}

/* ── 요약 카드 (성공·확인 필요·실패) ───────────── */
#SumOK, #SumWarn, #SumFail {{
    border-radius: 10px; padding: 8px 16px;
    font-size: {FONT_BASE}px; font-weight: bold;
}}
#SumOK   {{ background: #E4F1E9; color: {OK}; border: 2px solid {OK}; }}
#SumWarn {{ background: #F7EEDD; color: {WARN}; border: 2px solid {WARN}; }}
#SumFail {{ background: #F9E8E6; color: {DANGER}; border: 2px solid {DANGER}; }}
"""
