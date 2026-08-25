/**
 * 영상 합성용 오락이 컷아웃(배경 투명 PNG)을 만든다.
 *
 * 왜 따로 만드나:
 *   기존 assets/character/*.png 는 흰 배경이 박혀 있다(SVG 안에 흰 사각형이 있고,
 *   흰 페이지 위에서 찍었다). 그대로 영상에 얹으면 네모난 흰 상자가 보인다.
 *   그래서 흰 배경 사각형을 뺀 채 투명하게 다시 찍어 cutout/ 에 둔다.
 *
 * 원본(assets/character/*.png, svg/*.svg)은 건드리지 않는다.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SVG_DIR = path.join(ROOT, "assets", "character", "svg");
const OUT = path.join(ROOT, "assets", "character", "cutout");

/** 영상에 얹을 만한 전신 자세만 고른다 (얼굴 클로즈업은 합성에 안 쓴다) */
const WANTED = ["front", "side", "back"];

fs.mkdirSync(OUT, { recursive: true });

let browser = null;
for (const opts of [
  { executablePath: process.env.ORAKI_CHROMIUM ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" },
  { channel: "chrome" },
  { channel: "msedge" },
  {},
]) {
  try { browser = await chromium.launch(opts); break; } catch { /* 다음 후보 */ }
}
if (!browser) {
  console.log("  ⚠️ 브라우저를 찾지 못해 컷아웃을 만들지 못했습니다. 기존 이미지는 그대로입니다.");
  process.exit(0);
}

const page = await browser.newPage({ deviceScaleFactor: 2 });
let made = 0;
for (const name of WANTED) {
  const src = path.join(SVG_DIR, `${name}.svg`);
  if (!fs.existsSync(src)) { console.log(`  · ${name}.svg 없음 — 건너뜀`); continue; }

  // SVG 안의 흰 배경 사각형을 뺀다. 다른 도형은 건드리지 않는다.
  const svg = fs.readFileSync(src, "utf8")
    .replace(/<rect\s+width="100%"\s+height="100%"\s+fill="#FFFFFF"\s*\/>/i, "");

  const m = /width="(\d+)"\s+height="(\d+)"/.exec(svg);
  const w = m ? parseInt(m[1], 10) : 1024;
  const h = m ? parseInt(m[2], 10) : 1024;

  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<html><body style="margin:0">${svg}</body></html>`, { waitUntil: "load" });
  /* 그림이 실제로 차지하는 영역만 찍는다.
     정사각 캔버스를 그대로 쓰면 캐릭터 둘레에 투명 여백이 잔뜩 남아,
     영상에서 "높이 500px 로 얹어라" 해도 실제 키는 그 절반밖에 안 되고 공중에 뜬 것처럼 보였다.
     SVG 가 스스로 알려 주는 경계(getBBox)를 써서 정확히 잘라 낸다. */
  const box = await page.evaluate(() => {
    const svg = document.querySelector("svg");
    if (!svg) return null;
    const b = svg.getBBox();
    const pad = 4;   // 외곽선이 잘리지 않게 아주 살짝 여유
    return {
      x: Math.max(0, Math.floor(b.x - pad)),
      y: Math.max(0, Math.floor(b.y - pad)),
      width: Math.ceil(b.width + pad * 2),
      height: Math.ceil(b.height + pad * 2),
    };
  });

  const out = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: out, omitBackground: true, ...(box ? { clip: box } : {}) });
  made++;
  console.log(`  ✅ cutout/${name}.png  (${box ? `${box.width * 2}×${box.height * 2}` : "원본 크기"}, 배경 투명)`);
}
await browser.close();
console.log(`\n컷아웃 ${made}장 완료 — 영상 합성에 씁니다.`);
