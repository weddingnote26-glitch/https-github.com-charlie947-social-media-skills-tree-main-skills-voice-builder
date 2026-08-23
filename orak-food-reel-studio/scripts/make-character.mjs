#!/usr/bin/env node
/**
 * 만두탐정 오락이 Master Reference 이미지 생성기
 *
 *   npm run character
 *
 * assets/character/svg/*.svg  ← 수정 가능한 원본
 * assets/character/*.png      ← 프로그램이 쓰는 기준 이미지
 *
 * PNG 렌더링에는 브라우저 엔진이 필요합니다.
 * Chrome / Edge 가 설치돼 있으면 자동으로 찾아 씁니다. 없으면 SVG만 만들고 안내합니다.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VIEWS } from "./character/oraki-views.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "assets", "character");
const SVG_DIR = path.join(OUT, "svg");
fs.mkdirSync(SVG_DIR, { recursive: true });

console.log("\n🥟 만두탐정 오락이 — 기준 이미지 생성\n");

// 1) SVG 먼저 저장 (브라우저가 없어도 항상 성공)
for (const v of VIEWS) {
  fs.writeFileSync(path.join(SVG_DIR, `${v.file}.svg`), v.make(), "utf8");
  console.log(`  ✅ svg/${v.file}.svg`);
}

// 2) PNG 렌더링
let chromium;
try {
  ({ chromium } = await import("playwright-core"));
} catch {
  console.log("\n  ℹ️  playwright-core 가 없어 PNG는 건너뜁니다.");
  console.log("     PNG 기준 이미지는 이미 저장소에 포함돼 있으므로 그대로 쓰시면 됩니다.");
  console.log("     직접 다시 만들려면: npm i -D playwright-core  후 다시 실행\n");
  process.exit(0);
}

const candidates = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_CHROMIUM_PATH,
  "/opt/pw-browsers/chromium",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
].filter(Boolean);

let browser = null;
for (const executablePath of candidates) {
  if (!fs.existsSync(executablePath)) continue;
  try {
    browser = await chromium.launch({ executablePath });
    console.log(`\n  브라우저 엔진: ${executablePath}`);
    break;
  } catch { /* 다음 후보 */ }
}
if (!browser) {
  for (const channel of ["chrome", "msedge"]) {
    try { browser = await chromium.launch({ channel }); console.log(`\n  브라우저 엔진: ${channel}`); break; } catch { /* 다음 */ }
  }
}
if (!browser) {
  console.log("\n  ⚠️  Chrome/Edge 를 찾지 못해 PNG는 만들지 못했습니다. SVG는 정상 저장되었습니다.\n");
  process.exit(0);
}

const page = await browser.newPage({ deviceScaleFactor: 2 });
for (const v of VIEWS) {
  const svg = v.make();
  await page.setViewportSize({ width: v.w, height: v.h });
  await page.setContent(
    `<html><body style="margin:0;background:#fff">${svg}</body></html>`,
    { waitUntil: "load" },
  );
  await page.screenshot({ path: path.join(OUT, `${v.file}.png`), omitBackground: false });
  console.log(`  ✅ ${v.file}.png  (${v.w * 2}×${v.h * 2})`);
}
await browser.close();

console.log("\n완료! 프로그램의 🥟 캐릭터 메뉴에서 확인할 수 있습니다.\n");
