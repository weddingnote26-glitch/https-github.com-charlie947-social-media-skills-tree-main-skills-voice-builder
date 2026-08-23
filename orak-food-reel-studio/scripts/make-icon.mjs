#!/usr/bin/env node
/**
 * 앱 아이콘 만들기 (임시).
 * 최종 로고를 받기 전까지 쓰는 자리표시자다.
 * 진짜 로고가 나오면 electron/icon.png (1024x1024) 를 바꾸고 이 스크립트를 다시 돌리면 된다.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const OUT = path.join(process.cwd(), "electron");
fs.mkdirSync(OUT, { recursive: true });

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#F08A5D"/><stop offset="1" stop-color="#E86A3A"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" rx="220" fill="url(#g)"/>
  <!-- 만두 모양 (오락이) -->
  <ellipse cx="512" cy="590" rx="290" ry="235" fill="#FFF3E6"/>
  <path d="M232 520 q40 -70 94 0 q40 -70 94 0 q40 -70 94 0 q40 -70 94 0 q40 -70 94 0 q22 -38 60 -8
           l0 90 q-290 -40 -580 0 z" fill="#FFE3C4"/>
  <!-- 탐정 모자 -->
  <path d="M255 470 q255 -150 520 -40 l18 62 q-270 -95 -520 40 z" fill="#7B4A2B"/>
  <ellipse cx="470" cy="392" rx="188" ry="128" fill="#8B5533"/>
  <!-- 눈 -->
  <circle cx="430" cy="610" r="30" fill="#2B2B2B"/>
  <circle cx="600" cy="610" r="30" fill="#2B2B2B"/>
  <circle cx="440" cy="600" r="10" fill="#fff"/>
  <circle cx="610" cy="600" r="10" fill="#fff"/>
  <!-- 돋보기 -->
  <circle cx="742" cy="700" r="92" fill="none" stroke="#5A3A22" stroke-width="30"/>
  <circle cx="742" cy="700" r="76" fill="#BFE3F5" opacity="0.55"/>
  <rect x="800" y="762" width="130" height="34" rx="17" transform="rotate(42 800 762)" fill="#5A3A22"/>
</svg>`;

fs.writeFileSync(path.join(OUT, "icon.svg"), svg);

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await b.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
await page.setContent(`<body style="margin:0">${svg}</body>`);
await page.screenshot({ path: path.join(OUT, "icon.png"), omitBackground: true });

// Windows .ico — 여러 크기를 한 파일에 담는다
const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = [];
for (const s of sizes) {
  const p = await b.newPage({ viewport: { width: s, height: s } });
  await p.setContent(`<body style="margin:0"><div style="width:${s}px;height:${s}px">${svg.replace('width="1024" height="1024"', `width="${s}" height="${s}" viewBox="0 0 1024 1024"`)}</div></body>`);
  pngs.push({ size: s, buf: await p.screenshot({ omitBackground: true }) });
  await p.close();
}
await b.close();

// ICO 파일 구조: 헤더(6) + 항목별 16바이트 + PNG 데이터
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
let offset = 6 + pngs.length * 16;
const entries = [], datas = [];
for (const { size, buf } of pngs) {
  const e = Buffer.alloc(16);
  e.writeUInt8(size >= 256 ? 0 : size, 0);
  e.writeUInt8(size >= 256 ? 0 : size, 1);
  e.writeUInt8(0, 2); e.writeUInt8(0, 3);
  e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
  e.writeUInt32LE(buf.length, 8); e.writeUInt32LE(offset, 12);
  offset += buf.length;
  entries.push(e); datas.push(buf);
}
fs.writeFileSync(path.join(OUT, "icon.ico"), Buffer.concat([header, ...entries, ...datas]));
console.log("아이콘 생성 완료 (임시):");
for (const f of ["icon.svg", "icon.png", "icon.ico"]) {
  console.log("  electron/" + f, fs.statSync(path.join(OUT, f)).size + "바이트");
}
