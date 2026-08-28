"""화면 색·크기·글꼴을 한곳에 모았습니다.

분리규칙 §4: A(당근 카드뉴스)의 ``_공용\\theme.json`` 과는 **완전히 다른 파일**입니다.
한쪽 값을 다른 쪽에 복사하지 마세요. 아래 색은 전부 이 프로그램만의 값입니다.

담당자는 개발 지식이 없고 하루 종일 이 화면을 봅니다. 그래서
글씨를 크게, 여백을 넉넉히, 색은 적게 씁니다.
"""

from __future__ import annotations

# ── 색 ────────────────────────────────────────────────────────
# 색은 「상태」에만 씁니다. 장식으로 쓰지 않습니다.
BG = "#F4F3F0"          # 창 배경
CARD = "#FFFFFF"        # 카드·입력칸 배경
CARD_ALT = "#F8F7F4"    # 살짝 눌린 영역
INK = "#1C1C19"         # 본문 글자
INK_SOFT = "#5A5A52"    # 보조 설명
INK_FAINT = "#8A8A80"   # 흐린 안내
LINE = "#DCDBD4"        # 선
LINE_STRONG = "#C3C2B9"

ACCENT = "#A8541B"      # 주요 버튼 (오락이 탐정 가방 색 계열)
ACCENT_HOVER = "#8E4515"
ACCENT_SOFT = "#F6EAE0"

OK = "#1D6F42"
OK_SOFT = "#E4F0E9"
WARN = "#8F5A07"
WARN_SOFT = "#F8EDD9"
BAD = "#A32218"
BAD_SOFT = "#F9E4E1"

SIDEBAR_BG = "#26251F"
SIDEBAR_INK = "#EDECE4"
SIDEBAR_ACTIVE = "#3A3830"

# ── 글꼴 ──────────────────────────────────────────────────────
# 윈도우에서는 맑은 고딕이 잡힙니다. 이건 「화면 글꼴」이라 배포 대상이 아니므로
# 라이선스 문제가 없습니다. 영상에 굽는 자막 글꼴은 별개이며,
# 재배포 가능한 Noto Sans KR 만 씁니다 (§7 · assets/subtitle_style.json).
FONT_STACK = [
    "Malgun Gothic",       # Windows
    "Apple SD Gothic Neo",  # macOS
    "Noto Sans KR",
    "NanumGothic",
    "WenQuanYi Zen Hei",    # 리눅스 개발 환경
    "sans-serif",
]
FONT_FAMILY = ", ".join(f'"{f}"' for f in FONT_STACK)

# ── 글씨 크기 ─────────────────────────────────────────────────
FS_TITLE = 26
FS_HEAD = 19
FS_BODY = 15
FS_SMALL = 13
FS_TINY = 12
FS_MENU = 16

# ── 여백 ──────────────────────────────────────────────────────
PAD = 20
PAD_L = 28
GAP = 14
RADIUS = 8

# ── 창 ────────────────────────────────────────────────────────
WINDOW_W = 1120
WINDOW_H = 760
SIDEBAR_W = 210
FIELD_LABEL_W = 132       # 맛집 정보처럼 이름이 짧은 화면
FIELD_LABEL_W_WIDE = 200  # 설정처럼 이름이 긴 화면


def stylesheet() -> str:
    """창 전체에 한 번만 붙이는 스타일."""
    return f"""
    * {{
        font-family: {FONT_FAMILY};
        color: {INK};
    }}
    QWidget#Root {{ background: {BG}; }}

    /* ── 왼쪽 메뉴 ── */
    QWidget#Sidebar {{ background: {SIDEBAR_BG}; }}
    QLabel#BrandName {{
        color: {SIDEBAR_INK}; font-size: {FS_HEAD}px; font-weight: 700;
    }}
    QLabel#BrandSub {{
        color: #9B998C; font-size: {FS_TINY}px;
    }}
    QPushButton#MenuButton {{
        background: transparent; color: {SIDEBAR_INK};
        font-size: {FS_MENU}px; text-align: left;
        border: none; border-radius: {RADIUS}px;
        padding: 14px 16px;
    }}
    QPushButton#MenuButton:hover {{ background: {SIDEBAR_ACTIVE}; }}
    QPushButton#MenuButton:checked {{
        background: {SIDEBAR_ACTIVE}; font-weight: 700;
        border-left: 4px solid {ACCENT};
    }}

    /* ── 글자 ── */
    QLabel#ScreenTitle {{ font-size: {FS_TITLE}px; font-weight: 700; }}
    QLabel#ScreenSub  {{ font-size: {FS_BODY}px; color: {INK_SOFT}; }}
    QLabel#SectionHead {{ font-size: {FS_HEAD}px; font-weight: 700; }}
    QLabel#FieldLabel {{ font-size: {FS_BODY}px; font-weight: 600; }}
    QLabel#Hint {{ font-size: {FS_SMALL}px; color: {INK_FAINT}; }}

    /* ── 카드 ── */
    QFrame#Card {{
        background: {CARD}; border: 1px solid {LINE};
        border-radius: {RADIUS}px;
    }}

    /* ── 입력칸 ── */
    QLineEdit, QTextEdit, QPlainTextEdit, QComboBox, QSpinBox {{
        background: {CARD}; border: 1px solid {LINE_STRONG};
        border-radius: 6px; padding: 9px 11px;
        font-size: {FS_BODY}px;
    }}
    QLineEdit:focus, QTextEdit:focus, QPlainTextEdit:focus, QComboBox:focus {{
        border: 2px solid {ACCENT};
    }}
    QLineEdit:disabled, QTextEdit:disabled {{
        background: {CARD_ALT}; color: {INK_FAINT};
    }}

    /* ── 버튼 ── */
    QPushButton#Primary {{
        background: {ACCENT}; color: #FFFFFF;
        font-size: {FS_HEAD}px; font-weight: 700;
        border: none; border-radius: {RADIUS}px;
        padding: 15px 28px;
    }}
    QPushButton#Primary:hover {{ background: {ACCENT_HOVER}; }}
    QPushButton#Primary:disabled {{ background: {LINE_STRONG}; color: #FFFFFF; }}

    QPushButton#Secondary {{
        background: {CARD}; color: {INK};
        font-size: {FS_BODY}px; font-weight: 600;
        border: 1px solid {LINE_STRONG}; border-radius: {RADIUS}px;
        padding: 11px 20px;
    }}
    QPushButton#Secondary:hover {{ background: {CARD_ALT}; }}
    QPushButton#Secondary:disabled {{ color: {INK_FAINT}; }}

    /* ── 체크박스 ── */
    QCheckBox {{ font-size: {FS_BODY}px; spacing: 10px; }}
    QCheckBox::indicator {{ width: 22px; height: 22px; }}

    /* ── 아래 비용 표시줄 ── */
    QWidget#CostBar {{
        background: {CARD}; border-top: 1px solid {LINE};
    }}
    QLabel#CostText {{ font-size: {FS_BODY}px; font-weight: 600; }}
    QLabel#CostNote {{ font-size: {FS_SMALL}px; color: {INK_FAINT}; }}

    /* ── 스크롤 ── */
    QScrollArea {{ border: none; background: transparent; }}
    QScrollBar:vertical {{ background: transparent; width: 12px; margin: 0; }}
    QScrollBar::handle:vertical {{
        background: {LINE_STRONG}; border-radius: 6px; min-height: 40px;
    }}
    QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {{ height: 0; }}

    /* ── 표 ── */
    QTableWidget {{
        background: {CARD}; border: 1px solid {LINE};
        border-radius: {RADIUS}px; gridline-color: {LINE};
        font-size: {FS_BODY}px;
    }}
    QHeaderView::section {{
        background: {CARD_ALT}; border: none;
        border-bottom: 1px solid {LINE}; padding: 10px;
        font-size: {FS_SMALL}px; font-weight: 700; color: {INK_SOFT};
    }}
    """
