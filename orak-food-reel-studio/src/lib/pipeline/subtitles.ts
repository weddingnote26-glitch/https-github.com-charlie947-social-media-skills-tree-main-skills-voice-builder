import fs from "node:fs";
import path from "node:path";
import type { Scene } from "../schema";
import { getSettings } from "../settings";

/** §18 자막: SRT 별도 저장 + 렌더용 ASS(스타일 포함) 생성 */

export function buildSrt(scenes: Scene[]): string {
  return scenes.map((s, i) =>
    `${i + 1}\n${srtTime(s.start)} --> ${srtTime(s.end)}\n${s.subtitle.trim()}\n`
  ).join("\n");
}

function srtTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.round((sec - Math.floor(sec)) * 1000);
  const pad = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

/**
 * §19 자막 스타일: 큰 한글, 굵은 글씨, 높은 대비.
 * 화면 맨 아래는 피하고 Instagram UI Safe Zone 위에 배치.
 * 핵심 단어(숫자·가격·매장명 등)는 강조색.
 */
export interface AssOptions {
  highlightWords?: string[];
  /** §26 엔딩 시그니처: 마지막 1초 "사건 해결" + ORAK FOOD */
  endBadge?: { from: number; to: number; text: string };
}

export function buildAss(scenes: Scene[], opts?: AssOptions): string {
  const st = getSettings().subtitle;
  const marginV = Math.round(1920 * (st.marginBottomPct / 100)); // 아래에서 띄우는 픽셀
  const primary = "&H00FFFFFF";           // 흰색
  const outline = "&H00141414";           // 짙은 외곽선
  const highlight = assColor(st.highlightColor);

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Noto Sans KR ExtraBold,${st.fontSize},${primary},${primary},${outline},&H96000000,-1,0,0,0,100,100,0,0,1,7,2,2,60,60,${marginV},1
Style: Badge,Noto Sans KR ExtraBold,88,&H00FFFFFF,&H00FFFFFF,${assColor("#E86A3A").slice(0, -1)},&HB4000000,-1,0,0,0,100,100,2,0,1,9,3,5,60,60,0,1
Style: Brand,Noto Sans KR Medium,40,&H00FFFFFF,&H00FFFFFF,${outline},&H96000000,0,0,0,0,100,100,4,0,1,4,1,2,60,60,120,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const events = scenes.map((s) => {
    const text = decorate(s.subtitle.trim().replace(/\n/g, "\\N"), highlight, opts?.highlightWords ?? []);
    return `Dialogue: 0,${assTime(s.start)},${assTime(s.end)},Default,,0,0,0,,${text}`;
  }).join("\n");

  let extra = "";
  if (opts?.endBadge) {
    const b = opts.endBadge;
    extra =
      `\nDialogue: 1,${assTime(b.from)},${assTime(b.to)},Badge,,0,0,0,,{\\fad(120,0)}${b.text}` +
      `\nDialogue: 1,${assTime(b.from)},${assTime(b.to)},Brand,,0,0,0,,{\\fad(120,0)}ORAK FOOD`;
  }

  return header + events + extra + "\n";
}

/** 숫자/가격/강조어를 색으로 감쌈 */
function decorate(text: string, highlight: string, extraWords: string[]): string {
  let out = text.replace(/([0-9][0-9,.]*\s?(?:원|천 ?원|만 ?원|인분|분))/g, `{\\c${highlight}}$1{\\c&H00FFFFFF&}`);
  for (const w of extraWords) {
    if (!w || w.length < 2) continue;
    out = out.split(w).join(`{\\c${highlight}}${w}{\\c&H00FFFFFF&}`);
  }
  return out;
}

function assTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = (sec % 60).toFixed(2).padStart(5, "0");
  return `${h}:${String(m).padStart(2, "0")}:${s}`;
}

/** #RRGGBB → ASS &HBBGGRR& */
function assColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "&H004DD8FF&";
  const [r, g, b] = [m[1].slice(0, 2), m[1].slice(2, 4), m[1].slice(4, 6)];
  return `&H00${b}${g}${r}&`.toUpperCase();
}

export function writeSubtitles(
  scenes: Scene[],
  outDir: string,
  highlightWords: string[],
  endBadge?: AssOptions["endBadge"],
): { srtPath: string; assPath: string } {
  const srtPath = path.join(outDir, "subtitle.srt");
  const assPath = path.join(outDir, "subtitle.ass");
  fs.writeFileSync(srtPath, buildSrt(scenes), "utf8");
  fs.writeFileSync(assPath, buildAss(scenes, { highlightWords, endBadge }), "utf8");
  return { srtPath, assPath };
}
