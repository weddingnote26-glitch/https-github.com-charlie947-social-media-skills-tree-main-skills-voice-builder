/**
 * 만두탐정 오락이 — 캐릭터 아트 정의 (SVG 생성기)
 *
 * 이 파일이 캐릭터 디자인의 "원본"입니다.
 * 색·비율·소품을 여기서 고치면 기준 이미지 7종이 모두 같은 규칙으로 다시 만들어집니다.
 * (npm run character 로 재생성)
 */

/** 고정 색상 — 브랜드 오렌지는 작은 요소에만 사용 (캐릭터 전체를 주황으로 만들지 않음) */
export const C = {
  dough: "#FAF4E8",
  doughMid: "#F2E7D3",
  doughShade: "#DCC8A6",
  doughDeep: "#C9B08A",
  line: "#4A3626",
  hat: "#7C5636",
  hatDark: "#5E3F26",
  hatLight: "#9C6F49",
  brand: "#E86A3A",
  brandDark: "#BF5227",
  brandSoft: "#F6C0A4",
  cheek: "#F2A084",
  eye: "#3B2A1E",
  paper: "#FCF5E5",
  metalDark: "#8B9299",
  glass: "#CDE9F5",
  plaidA: "#8A5F3C",
  plaidB: "#A97C4F",
};

export const STROKE = 7;

const S = (extra = "") =>
  `fill="none" stroke="${C.line}" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round" ${extra}`;
const F = (fill, extra = "") =>
  `fill="${fill}" stroke="${C.line}" stroke-width="${STROKE}" stroke-linejoin="round" stroke-linecap="round" ${extra}`;

/** 공통 defs — 그라데이션 / 체크무늬 / 그림자 */
export function defs() {
  return `
  <defs>
    <radialGradient id="doughG" cx="38%" cy="28%" r="80%">
      <stop offset="0%" stop-color="#FFFDF7"/>
      <stop offset="55%" stop-color="${C.dough}"/>
      <stop offset="100%" stop-color="${C.doughShade}"/>
    </radialGradient>
    <radialGradient id="doughBack" cx="50%" cy="34%" r="76%">
      <stop offset="0%" stop-color="${C.dough}"/>
      <stop offset="100%" stop-color="${C.doughDeep}"/>
    </radialGradient>
    <linearGradient id="hatG" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${C.hatLight}"/>
      <stop offset="100%" stop-color="${C.hat}"/>
    </linearGradient>
    <linearGradient id="bagG" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${C.brand}"/>
      <stop offset="100%" stop-color="${C.brandDark}"/>
    </linearGradient>
    <linearGradient id="glassG" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#EAF7FC" stop-opacity="0.95"/>
      <stop offset="60%" stop-color="${C.glass}" stop-opacity="0.7"/>
      <stop offset="100%" stop-color="#9FD3E8" stop-opacity="0.55"/>
    </linearGradient>
    <pattern id="plaid" width="46" height="46" patternUnits="userSpaceOnUse">
      <rect width="46" height="46" fill="${C.plaidA}"/>
      <rect width="46" height="16" y="15" fill="${C.plaidB}" opacity="0.75"/>
      <rect width="16" height="46" x="15" fill="${C.plaidB}" opacity="0.75"/>
      <rect width="16" height="16" x="15" y="15" fill="${C.brand}" opacity="0.5"/>
    </pattern>
  </defs>`;
}

/* ─────────── 머리(만두) ─────────── */

/**
 * 만두 주름 기하 — 머리 윗부분이 실제 찐만두처럼 오므려 붙인 형태가 되도록
 * 실루엣 자체에 주름을 넣는다. (작은 화면에서도 "만두"로 읽히는 핵심)
 */
export const CROWN = { x0: 268, x1: 732, y: 252, bumps: 6 };
const BW = (CROWN.x1 - CROWN.x0) / CROWN.bumps;

/** 만두 머리 외곽 — 윗면은 주름(스캘럽), 아래는 통통한 둥근 형태 */
export function headShape(fill = "url(#doughG)", { cx = 500 } = {}) {
  const { x0, x1, y, bumps } = CROWN;
  let d = `M232,394 C 232,318 244,272 ${x0},${y}`;
  for (let i = 0; i < bumps; i++) {
    d += ` A ${BW / 2},${BW * 0.62} 0 0 1 ${(x0 + BW * (i + 1)).toFixed(1)},${y}`;
  }
  d += ` C ${x1 + 24},272 768,318 768,394`;
  d += ` C 768,518 668,596 500,596 C 332,596 232,518 232,394 Z`;
  return `<g transform="translate(${cx - 500} 0)"><path d="${d}" ${F(fill)}/></g>`;
}

/** 주름 접힘선 — 머리 외곽과 같은 기하를 공유. 짧고 굵게 넣어 "오므린 만두피"로 읽히게 한다 */
export function pleats({ cx = 500 } = {}) {
  const { x0, y, bumps } = CROWN;
  const folds = [];
  for (let i = 1; i < bumps; i++) {
    const vx = (x0 + BW * i).toFixed(1);
    // 골짜기마다 아래로 짧게 내려오는 접힘 + 끝을 살짝 안쪽으로
    folds.push(`<path d="M${vx},${y - 4} C ${vx},${y + 10} ${vx},${y + 20} ${(x0 + BW * i + (i < bumps / 2 ? 5 : -5)).toFixed(1)},${y + 30}"
      ${S(`stroke="${C.doughDeep}" stroke-width="8" opacity="0.8"`)}/>`);
  }
  return `<g transform="translate(${cx - 500} 0)">${folds.join("")}</g>`;
}

/* ─────────── 표정 ─────────── */

const EXPR = {
  neutral: { eye: "open", mouth: "M452,472 Q500,502 548,472", brow: null },
  happy: { eye: "arc", mouth: "M440,462 Q500,524 560,462", brow: null },
  surprised: { eye: "wide", mouth: "ellipse", brow: "raise" },
  detective: { eye: "open", mouth: "M456,480 Q500,496 544,480", brow: "narrow" },
};

export function face(expression = "neutral", { cx = 500, eyeY = 388 } = {}) {
  const e = EXPR[expression] ?? EXPR.neutral;
  const lx = cx - 88;
  const rx = cx + 88;

  const eye = (x) => {
    if (e.eye === "arc") {
      return `<path d="M${x - 46},${eyeY + 10} Q${x},${eyeY - 46} ${x + 46},${eyeY + 10}"
        fill="none" stroke="${C.eye}" stroke-width="18" stroke-linecap="round"/>`;
    }
    const rxE = e.eye === "wide" ? 50 : 44;
    const ryE = e.eye === "wide" ? 58 : 50;
    const irisR = e.eye === "wide" ? 30 : 33;
    return `
      <ellipse cx="${x}" cy="${eyeY}" rx="${rxE}" ry="${ryE}" fill="#FFFFFF" stroke="${C.line}" stroke-width="6"/>
      <circle cx="${x + 3}" cy="${eyeY + 4}" r="${irisR}" fill="${C.eye}"/>
      <circle cx="${x - 9}" cy="${eyeY - 12}" r="11" fill="#FFFFFF"/>
      <circle cx="${x + 15}" cy="${eyeY + 16}" r="5" fill="#FFFFFF" opacity="0.75"/>`;
  };

  const brow = () => {
    if (e.brow === "raise") {
      return `<path d="M${lx - 40},${eyeY - 80} Q${lx},${eyeY - 98} ${lx + 40},${eyeY - 80}" ${S('stroke-width="10"')}/>
              <path d="M${rx - 40},${eyeY - 80} Q${rx},${eyeY - 98} ${rx + 40},${eyeY - 80}" ${S('stroke-width="10"')}/>`;
    }
    if (e.brow === "narrow") {
      return `<path d="M${lx - 40},${eyeY - 76} L${lx + 36},${eyeY - 60}" ${S('stroke-width="11"')}/>
              <path d="M${rx + 40},${eyeY - 76} L${rx - 36},${eyeY - 60}" ${S('stroke-width="11"')}/>`;
    }
    return "";
  };

  const mouth =
    e.mouth === "ellipse"
      ? `<ellipse cx="${cx}" cy="${eyeY + 98}" rx="26" ry="32" fill="${C.line}"/>
         <ellipse cx="${cx}" cy="${eyeY + 106}" rx="14" ry="16" fill="${C.brandDark}" opacity="0.5"/>`
      : `<path d="${e.mouth}" fill="none" stroke="${C.line}" stroke-width="10" stroke-linecap="round"/>`;

  return `
  <g>
    ${brow()}
    ${eye(lx)}
    ${eye(rx)}
    <ellipse cx="${lx - 34}" cy="${eyeY + 68}" rx="34" ry="20" fill="${C.cheek}" opacity="0.5"/>
    <ellipse cx="${rx + 34}" cy="${eyeY + 68}" rx="34" ry="20" fill="${C.cheek}" opacity="0.5"/>
    ${mouth}
  </g>`;
}

/* ─────────── 탐정 모자 ─────────── */

/**
 * 브라운 탐정 헌팅캡 — 돋보기와 함께 캐릭터 인지도의 핵심.
 * 머리 왼쪽 위에 비스듬히 얹어 오른쪽 만두 주름이 그대로 보이게 한다.
 */
export function hat({ rotate = -14, cx = 456, cy = 232, badge = true, bill = true } = {}) {
  return `
  <g transform="rotate(${rotate} ${cx} ${cy})">
    ${
      bill
        ? `<path d="M${cx - 40},${cy + 26} C ${cx - 112},${cy + 22} ${cx - 178},${cy + 40} ${cx - 190},${cy + 62}
                    C ${cx - 172},${cy + 80} ${cx - 96},${cy + 74} ${cx - 34},${cy + 58} Z" ${F(C.hatDark)}/>`
        : ""
    }
    <path d="M${cx - 158},${cy + 40} C ${cx - 176},${cy - 34} ${cx - 108},${cy - 96} ${cx - 6},${cy - 96}
             C ${cx + 92},${cy - 96} ${cx + 152},${cy - 40} ${cx + 146},${cy + 24}
             C ${cx + 74},${cy + 58} ${cx - 84},${cy + 62} ${cx - 158},${cy + 40} Z" ${F("url(#hatG)")}/>
    <path d="M${cx - 154},${cy + 22} C ${cx - 78},${cy + 50} ${cx + 74},${cy + 46} ${cx + 148},${cy + 8}"
      ${S(`stroke="${C.hatDark}" stroke-width="17" opacity="0.9"`)}/>
    <path d="M${cx - 96},${cy - 62} C ${cx - 58},${cy - 84} ${cx + 4},${cy - 88} ${cx + 44},${cy - 72}"
      ${S('stroke="#FFFFFF" stroke-width="10" opacity="0.28"')}/>
    <circle cx="${cx - 4}" cy="${cy - 88}" r="16" ${F(badge ? C.brand : C.hatDark, 'stroke-width="6"')}/>
  </g>`;
}

/* ─────────── 몸통 · 팔 · 다리 ─────────── */

export function bodyAndLegs({ back = false } = {}) {
  return `
  <g>
    <path d="M424,802 L424,846 C 424,864 394,868 394,880 L474,880 L474,802 Z" ${F(C.hatDark)}/>
    <path d="M576,802 L576,846 C 576,864 606,868 606,880 L526,880 L526,802 Z" ${F(C.hatDark)}/>
    <path d="M392,608 C 392,584 608,584 608,608 L620,778 C 622,804 560,820 500,820 C 440,820 378,804 380,778 Z"
      ${F("url(#plaid)")}/>
    <path d="M392,608 C 392,584 608,584 608,608 L604,648 C 540,634 460,634 396,648 Z" ${F(C.hatDark, 'opacity="0.92"')}/>
    ${
      back
        ? `<path d="M500,650 L500,806" ${S(`stroke="${C.hatDark}" stroke-width="6" opacity="0.55"`)}/>`
        : `<path d="M500,648 L500,806" ${S(`stroke="${C.hatDark}" stroke-width="6" opacity="0.7"`)}/>
           <circle cx="500" cy="700" r="11" ${F(C.brandSoft, 'stroke-width="5"')}/>
           <circle cx="500" cy="758" r="11" ${F(C.brandSoft, 'stroke-width="5"')}/>`
    }
  </g>`;
}

/** 오렌지색 미니 탐정 가방 — 브랜드 인지 요소 */
export function bag({ x = 642, y = 730, strap = true } = {}) {
  return `
  <g>
    ${strap ? `<path d="M436,620 C 510,700 584,694 ${x - 8},${y - 40}" ${S(`stroke="${C.brandDark}" stroke-width="19"`)}/>` : ""}
    <rect x="${x - 52}" y="${y - 40}" width="104" height="84" rx="16" ${F("url(#bagG)")}/>
    <path d="M${x - 52},${y - 10} C ${x - 20},${y + 6} ${x + 20},${y + 6} ${x + 52},${y - 10}"
      ${S(`stroke="${C.brandDark}" stroke-width="7"`)}/>
    <rect x="${x - 15}" y="${y - 20}" width="30" height="24" rx="6" ${F(C.paper, 'stroke-width="5"')}/>
  </g>`;
}

/** 팔 — 각도로 자세를 바꿈 (angle: 아래쪽이 +) */
export function arm({ side = "left", angle = 24, length = 118, y = 664 } = {}) {
  const sx = side === "left" ? 398 : 602;
  const dir = side === "left" ? -1 : 1;
  const rad = (angle * Math.PI) / 180;
  const ex = sx + dir * Math.cos(rad) * length;
  const ey = y + Math.sin(rad) * length;
  return `
  <g>
    <path d="M${sx},${y} L${ex},${ey}" ${S(`stroke="${C.line}" stroke-width="44"`)}/>
    <path d="M${sx},${y} L${ex},${ey}" ${S(`stroke="${C.plaidA}" stroke-width="32"`)}/>
    <circle cx="${ex}" cy="${ey}" r="30" ${F(C.dough)}/>
  </g>`;
}

/* ─────────── 소품 ─────────── */

/** 돋보기 — 탐정 모자와 함께 핵심 아이덴티티 */
export function magnifier({ x = 250, y = 700, scale = 1, rotate = -28 } = {}) {
  return `
  <g transform="translate(${x} ${y}) rotate(${rotate}) scale(${scale})">
    <path d="M30,36 L96,108" ${S(`stroke="${C.hatDark}" stroke-width="26"`)}/>
    <circle cx="0" cy="0" r="62" fill="url(#glassG)" stroke="${C.metalDark}" stroke-width="14"/>
    <circle cx="0" cy="0" r="62" ${S('stroke-width="5" opacity="0.45"')}/>
    <path d="M-30,-24 C -14,-42 14,-44 28,-32" ${S('stroke="#FFFFFF" stroke-width="10" opacity="0.7"')}/>
  </g>`;
}

/** 탐정 수첩 */
export function notepad({ x = 762, y = 700, rotate = 12 } = {}) {
  return `
  <g transform="translate(${x} ${y}) rotate(${rotate})">
    <rect x="-52" y="-64" width="104" height="128" rx="10" ${F(C.paper)}/>
    <path d="M-52,-54 L52,-54" ${S(`stroke="${C.brand}" stroke-width="30"`)}/>
    ${[-10, 12, 34].map((ly) => `<path d="M-30,${ly} L30,${ly}" ${S(`stroke="${C.doughDeep}" stroke-width="7"`)}/>`).join("")}
    ${[-34, -12, 10, 32].map((cx2) => `<circle cx="${cx2}" cy="-64" r="6" fill="${C.metalDark}"/>`).join("")}
  </g>`;
}

export function groundShadow(cx = 500, cy = 892, rx = 205) {
  return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="30" fill="${C.line}" opacity="0.13"/>`;
}
