/**
 * 만두탐정 오락이 — Master Reference 7종 구성
 * front / side / back / face_happy / face_surprised / face_detective / character_sheet
 */
import {
  C, defs, headShape, pleats, face, hat, bodyAndLegs, bag, arm,
  magnifier, notepad, groundShadow,
} from "./oraki-art.mjs";

const BG = "#FFFFFF";

/** 캐릭터 시트에 끼워 넣을 때: 바깥 svg 태그와 배경 사각형을 제거 */
function bare(svgString) {
  return svgString
    .replace(/^<svg[^>]*>/, "")
    .replace(/<\/svg>$/, "")
    .replace(/<rect width="100%" height="100%"[^>]*\/>/, "");
}

function svg(w, h, inner, { bg = BG, viewBox = `0 0 ${w} ${h}` } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${viewBox}">
  ${defs()}
  <rect width="100%" height="100%" fill="${bg}"/>
  ${inner}
</svg>`;
}

/* ─────────── 정면 (기본 자세: 돋보기 + 수첩) ─────────── */
export function front() {
  const inner = `
  ${groundShadow()}
  ${magnifier({ x: 155, y: 690, rotate: -30 })}
  ${notepad({ x: 762, y: 706, rotate: 12 })}
  ${arm({ side: "left", angle: 34, length: 128 })}
  ${arm({ side: "right", angle: 28, length: 124 })}
  ${bodyAndLegs()}
  ${bag()}
  ${headShape()}
  ${pleats()}
  ${face("neutral")}
  ${hat()}`;
  return svg(1024, 1024, inner);
}

/* ─────────── 측면 ─────────── */
export function side() {
  const inner = `
  ${groundShadow(520, 892, 180)}
  ${magnifier({ x: 250, y: 712, rotate: -44, scale: 0.94 })}
  <g>
    <path d="M470,802 L470,846 C 470,864 434,868 434,880 L520,880 L520,802 Z"
      fill="${C.hatDark}" stroke="${C.line}" stroke-width="7" stroke-linejoin="round"/>
    <path d="M556,802 L556,846 C 556,864 594,868 594,880 L512,880 L512,802 Z"
      fill="${C.hatDark}" stroke="${C.line}" stroke-width="7" stroke-linejoin="round"/>
    <path d="M432,608 C 432,584 610,584 610,608 L618,778 C 620,804 566,820 516,820 C 466,820 416,804 418,778 Z"
      fill="url(#plaid)" stroke="${C.line}" stroke-width="7" stroke-linejoin="round"/>
    <path d="M432,608 C 432,584 610,584 610,608 L606,648 C 550,634 486,634 436,648 Z"
      fill="${C.hatDark}" stroke="${C.line}" stroke-width="7" stroke-linejoin="round" opacity="0.92"/>
  </g>
  <g>
    <path d="M470,664 L372,742" fill="none" stroke="${C.line}" stroke-width="44" stroke-linecap="round"/>
    <path d="M470,664 L372,742" fill="none" stroke="${C.plaidA}" stroke-width="32" stroke-linecap="round"/>
    <circle cx="372" cy="742" r="30" fill="${C.dough}" stroke="${C.line}" stroke-width="7"/>
  </g>
  ${bag({ x: 636, y: 728, strap: false })}
  <path d="M470,616 C 520,690 580,692 628,694" fill="none" stroke="${C.brandDark}" stroke-width="15" stroke-linecap="round"/>

  <!-- 옆에서 본 머리 (같은 만두 주름 기하를 공유) -->
  ${headShape("url(#doughG)", { cx: 520 })}
  ${pleats({ cx: 520 })}
  <!-- 한쪽 눈만 보이는 측면 표정 -->
  <g>
    <ellipse cx="380" cy="392" rx="44" ry="50" fill="#FFFFFF" stroke="${C.line}" stroke-width="6"/>
    <circle cx="370" cy="396" r="33" fill="${C.eye}"/>
    <circle cx="358" cy="380" r="11" fill="#FFFFFF"/>
    <ellipse cx="322" cy="458" rx="32" ry="19" fill="${C.cheek}" opacity="0.5"/>
    <path d="M322,470 Q356,494 392,472" fill="none" stroke="${C.line}" stroke-width="10" stroke-linecap="round"/>
    <path d="M694,398 C 716,392 720,414 700,424" fill="none" stroke="${C.line}" stroke-width="7" stroke-linecap="round" opacity="0.5"/>
  </g>
  ${hat({ rotate: -12, cx: 466, cy: 234 })}`;
  return svg(1024, 1024, inner);
}

/* ─────────── 후면 ─────────── */
export function back() {
  const inner = `
  ${groundShadow()}
  ${arm({ side: "left", angle: 30, length: 120 })}
  ${arm({ side: "right", angle: 30, length: 120 })}
  ${bodyAndLegs({ back: true })}
  ${headShape("url(#doughBack)")}
  ${pleats()}
  <path d="M356,436 C 420,478 580,478 644,436" fill="none" stroke="${C.doughDeep}" stroke-width="7" stroke-linecap="round" opacity="0.5"/>
  <!-- 뒤에서 보이는 가방 + 어깨끈 -->
  <path d="M436,620 C 500,660 560,660 620,646" fill="none" stroke="${C.brandDark}" stroke-width="15" stroke-linecap="round"/>
  <path d="M564,620 C 540,680 528,720 524,760" fill="none" stroke="${C.brandDark}" stroke-width="15" stroke-linecap="round"/>
  ${hat({ rotate: -14, badge: false, bill: false })}
  <path d="M372,236 C 420,214 486,208 540,220" fill="none" stroke="${C.hatDark}" stroke-width="12" stroke-linecap="round" opacity="0.75"/>`;
  return svg(1024, 1024, inner);
}

/* ─────────── 표정 클로즈업 3종 ─────────── */
function faceShot(expression) {
  const inner = `
  ${headShape()}
  ${pleats()}
  ${face(expression)}
  ${hat()}`;
  // 머리만 크게 (y 60~620 영역을 잘라 정사각형으로)
  return svg(768, 768, inner, { viewBox: "200 100 600 600" });
}

export const faceHappy = () => faceShot("happy");
export const faceSurprised = () => faceShot("surprised");
export const faceDetective = () => faceShot("detective");

/* ─────────── 캐릭터 시트 ─────────── */
export function characterSheet() {
  const T = (x, y, text, size = 26, weight = 700, fill = C.line, anchor = "middle") =>
    `<text x="${x}" y="${y}" font-family="Noto Sans KR, Malgun Gothic, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${text}</text>`;

  const swatches = [
    ["#FAF4E8", "만두피"],
    ["#7C5636", "탐정 모자"],
    ["#E86A3A", "브랜드"],
    ["#8A5F3C", "체크 의상"],
    ["#3B2A1E", "눈·라인"],
    ["#F2A084", "볼터치"],
  ];

  const inner = `
  <rect width="2100" height="1500" fill="#FBFAF7"/>
  <rect x="0" y="0" width="2100" height="104" fill="${C.line}"/>
  ${T(60, 66, "만두탐정 오락이 · CHARACTER MASTER REFERENCE", 40, 800, "#FFFFFF", "start")}
  ${T(2040, 64, "ORAK FOOD", 30, 700, C.brandSoft, "end")}

  <!-- 3면도 -->
  <g transform="translate(40 130) scale(0.52)">${bare(front())}</g>
  <g transform="translate(600 130) scale(0.52)">${bare(side())}</g>
  <g transform="translate(1160 130) scale(0.52)">${bare(back())}</g>
  ${T(306, 706, "정면 FRONT", 28)}
  ${T(866, 706, "측면 SIDE", 28)}
  ${T(1426, 706, "후면 BACK", 28)}

  <!-- 비율 가이드 -->
  <g transform="translate(1690 150)">
    <rect x="0" y="0" width="370" height="540" rx="18" fill="#FFFFFF" stroke="${C.doughShade}" stroke-width="3"/>
    ${T(185, 46, "크기 · 비율", 26)}
    <line x1="330" y1="80" x2="330" y2="470" stroke="${C.brand}" stroke-width="4" stroke-dasharray="10 8"/>
    <line x1="318" y1="80" x2="342" y2="80" stroke="${C.brand}" stroke-width="5"/>
    <line x1="318" y1="470" x2="342" y2="470" stroke="${C.brand}" stroke-width="5"/>
    ${T(96, 130, "실제 크기 약 18cm", 24, 700, C.brand, "start")}
    ${T(96, 176, "(테이블 위 크기)", 20, 500, "#7A6A58", "start")}
    ${T(96, 240, "머리 : 몸 = 3 : 2", 22, 600, C.line, "start")}
    ${T(96, 286, "사람만큼 크게", 22, 600, "#B4483A", "start")}
    ${T(96, 322, "그리지 않는다", 22, 600, "#B4483A", "start")}
    ${T(96, 392, "음식 60%", 22, 700, C.line, "start")}
    ${T(96, 428, "오락이 40%", 22, 700, C.line, "start")}
    ${T(96, 470, "음식 장면에서는", 19, 500, "#7A6A58", "start")}
    ${T(96, 500, "35% 미만", 19, 500, "#7A6A58", "start")}
  </g>

  <!-- 표정 -->
  ${T(60, 800, "표정 EXPRESSIONS", 30, 800, C.line, "start")}
  <g transform="translate(60 820) scale(0.42)">${bare(faceHappy())}</g>
  <g transform="translate(400 820) scale(0.42)">${bare(faceSurprised())}</g>
  <g transform="translate(740 820) scale(0.42)">${bare(faceDetective())}</g>
  ${T(221, 1176, "Happy / Satisfied", 24)}
  ${T(561, 1176, "Surprised / Shocked", 24)}
  ${T(901, 1176, "Serious Detective", 24)}
  ${T(60, 1218, "※ 표정은 과장되어도 얼굴 형태·눈 모양·비율은 절대 바뀌지 않는다", 22, 500, "#7A6A58", "start")}

  <!-- 소품 -->
  ${T(1120, 800, "대표 소품 PROPS", 30, 800, C.line, "start")}
  <g transform="translate(1130 900) scale(0.85)">${magnifier({ x: 90, y: 90, rotate: -24 })}</g>
  ${T(1215, 1080, "돋보기", 24)}
  <g transform="translate(1330 810) scale(0.85)">${notepad({ x: 90, y: 190, rotate: 8 })}</g>
  ${T(1415, 1080, "탐정 수첩", 24)}
  <g transform="translate(1520 830) scale(0.9)">${bag({ x: 90, y: 190, strap: false })}</g>
  ${T(1605, 1080, "오렌지 가방", 24)}
  <g transform="translate(1700 762) scale(0.62)">${hat({ rotate: 0, cx: 260, cy: 320 })}</g>
  ${T(1862, 1080, "탐정 모자", 24)}
  ${T(1120, 1122, "※ 매 영상에 최소 한 가지 이상 등장 — 짧은 영상에서도 브랜드를 기억하게 하는 장치", 22, 500, "#7A6A58", "start")}

  <!-- 컬러 -->
  ${T(60, 1268, "컬러 COLOR", 30, 800, C.line, "start")}
  ${swatches
    .map(
      ([hex, name], i) => `
    <g transform="translate(${60 + i * 190} 1290)">
      <rect width="150" height="86" rx="14" fill="${hex}" stroke="${C.doughShade}" stroke-width="3"/>
      ${T(75, 132, name, 22, 700)}
      ${T(75, 160, hex, 19, 500, "#7A6A58")}
    </g>`,
    )
    .join("")}
  <g transform="translate(1220 1290)">
    <rect width="820" height="150" rx="16" fill="#FFFFFF" stroke="${C.brandSoft}" stroke-width="3"/>
    ${T(30, 44, "고정 요소 (Character Lock)", 24, 800, C.brand, "start")}
    ${T(30, 84, "만두 형태 · 얼굴 · 눈 모양 · 탐정 모자 · 몸 비율 · 대표 컬러 · 가방", 22, 500, C.line, "start")}
    ${T(30, 122, "사용자가 바꾸지 않는 한 AI가 임의로 디자인을 변경하지 않는다", 21, 500, "#7A6A58", "start")}
  </g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="2100" height="1500" viewBox="0 0 2100 1500">
  ${defs()}
  ${inner}
</svg>`;
}

export const VIEWS = [
  { file: "front", w: 1024, h: 1024, make: front },
  { file: "side", w: 1024, h: 1024, make: side },
  { file: "back", w: 1024, h: 1024, make: back },
  { file: "face_happy", w: 768, h: 768, make: faceHappy },
  { file: "face_surprised", w: 768, h: 768, make: faceSurprised },
  { file: "face_detective", w: 768, h: 768, make: faceDetective },
  { file: "character_sheet", w: 2100, h: 1500, make: characterSheet },
];
