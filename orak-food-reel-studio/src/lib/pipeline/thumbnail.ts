import fs from "node:fs";
import path from "node:path";
import { runFFmpeg } from "../ffmpeg";
import { DIRS } from "../paths";
import { caseLabel } from "../character/oraki";
import { escapeFilterPath } from "./render";

/**
 * §23~24 썸네일 — 1080×1920, 그리드에서도 문구가 잘리지 않는 중앙 Safe Zone.
 * 텍스트는 libass(subtitles 필터)로 렌더 — drawtext가 없는 FFmpeg 빌드에서도 동작.
 */
export function buildThumbAss(lines: string[], caseNumber?: number | null): string {
  const kept = lines.filter(Boolean).slice(0, 3);
  const lineH = 150;
  const centerY = 980;
  const startY = centerY - Math.round(((kept.length - 1) * lineH) / 2);
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Title,Noto Sans KR ExtraBold,112,&H00FFFFFF,&H00FFFFFF,&H00141414,&H78000000,-1,0,0,0,100,100,0,0,1,8,3,5,40,40,0,1
Style: Case,Noto Sans KR ExtraBold,58,&H00FFFFFF,&H00FFFFFF,&H003A6AE8,&H003A6AE8,-1,0,0,0,100,100,1,0,3,14,0,5,40,40,0,1
Style: Brand,Noto Sans KR Medium,42,&H00FFFFFF,&H00FFFFFF,&H00141414,&H78000000,0,0,0,0,100,100,5,0,1,4,1,5,40,40,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const ev: string[] = [];
  kept.forEach((line, i) => {
    ev.push(`Dialogue: 1,0:00:00.00,0:00:01.00,Title,,0,0,0,,{\\pos(540,${startY + i * lineH})}${line}`);
  });
  if (caseNumber) {
    ev.push(`Dialogue: 1,0:00:00.00,0:00:01.00,Case,,0,0,0,,{\\pos(540,${startY - 170})}${caseLabel(caseNumber)}`);
  }
  ev.push(`Dialogue: 1,0:00:00.00,0:00:01.00,Brand,,0,0,0,,{\\pos(540,${startY + kept.length * lineH + 90})}ORAK FOOD`);
  return header + ev.join("\n") + "\n";
}

export function buildThumbnailArgs(opts: {
  baseImage: string;
  outPath: string;
  assPath: string;
}): string[] {
  const vf = [
    `scale=2160:3840:force_original_aspect_ratio=increase`,
    `crop=2160:3840`,
    `scale=1080:1920`,
    `drawbox=x=0:y=740:w=1080:h=560:color=black@0.42:t=fill`,
    `subtitles=filename='${escapeFilterPath(opts.assPath)}':fontsdir='${escapeFilterPath(DIRS.fonts)}'`,
  ].join(",");
  return ["-hide_banner", "-loglevel", "error", "-i", opts.baseImage, "-vf", vf, "-frames:v", "1", "-q:v", "3", "-y", opts.outPath];
}

export async function makeThumbnail(opts: {
  baseImage: string;
  outPath: string;
  lines: string[];
  caseNumber?: number | null;
}): Promise<string> {
  const assPath = path.join(path.dirname(opts.outPath), "thumbnail.ass");
  fs.writeFileSync(assPath, buildThumbAss(opts.lines, opts.caseNumber), "utf8");
  await runFFmpeg(buildThumbnailArgs({ baseImage: opts.baseImage, outPath: opts.outPath, assPath }));
  return opts.outPath;
}

/** 훅에서 썸네일 문구 2~3줄 뽑기 (§24: 텍스트 최소화) */
export function thumbnailLines(hook: string, area: string): string[] {
  const clean = hook.replace(/[.?!…]+$/, "");
  if (clean.length <= 10) return [clean];
  const words = clean.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > 9 && cur) {
      lines.push(cur);
      cur = w;
      if (lines.length === 3) break;
    } else {
      cur = (cur + " " + w).trim();
    }
  }
  if (cur && lines.length < 3) lines.push(cur);
  return lines.length ? lines.slice(0, 3) : [`${area}에서 찾은`, "오늘의 맛집"];
}
