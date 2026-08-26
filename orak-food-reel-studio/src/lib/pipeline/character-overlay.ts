/**
 * 만두탐정 오락이를 영상에 **직접 합성**한다.
 *
 * 왜 이렇게 하나:
 *   예전에는 "참조 이미지를 줄 테니 네가 그려 줘" 하고 이미지 AI 에 맡겼다.
 *   그런데 모델이 캐릭터를 빼먹거나 다른 얼굴로 그리는 일이 잦았고,
 *   Sample 모드나 배경 전용 모델에서는 아예 나오지 않았다.
 *   그래서 캐릭터는 AI 에 기대지 않고 **우리가 PNG 를 얹는다.** 이러면 언제나 나온다.
 *
 * 지키는 것:
 *   - 배경 위 오른쪽/왼쪽 아래에 서 있게 둔다 (음식이 가려지지 않게)
 *   - 장면 역할(hero/side/corner)에 따라 크기를 달리한다
 *   - 자막이 있는 아래쪽 영역은 피한다
 */
import fs from "node:fs";
import path from "node:path";
import type { Scene } from "../schema";
import { orakiAssets } from "../character/asset-root";
import { DIRS } from "../paths";

/** 영상 크기 — render.ts 와 같은 값 */
const W = 1080;
const H = 1920;

/**
 * 자막이 앉는 아래쪽 영역. 캐릭터 발이 이 위에 오게 한다.
 * 자막은 화면 아래에서 약 22% 지점에 앉으므로 그보다 조금 위를 바닥으로 삼는다.
 */
const SUBTITLE_BAND = Math.round(H * 0.30);

export interface CharacterPlacement {
  scene: number;
  /** 합성할 PNG (배경 투명) */
  imagePath: string;
  /** 화면에서 차지할 높이 픽셀 */
  height: number;
  /** 왼쪽 위 좌표 */
  x: number;
  y: number;
  /** 좌우 반전할지 — 같은 그림만 반복되면 지루하다 */
  flip: boolean;
  start: number;
  end: number;
}

/**
 * 판(간판·메뉴판·정보판)이 얹히는 장면에서 캐릭터가 올라올 수 있는 최대 비율.
 *
 * 실제로 겪은 일: 마지막 장면에서 이용 정보 판이 오락이 모자와 겹쳐 보였다.
 * 판은 화면 위쪽, 자막은 아래쪽에 있으므로 캐릭터는 그 사이에 서야 한다.
 * 가로로 자리를 다투게 하는 것보다 위아래로 나누는 편이 확실하다.
 */
const PANEL_MAX_RATIO = 0.34;

/** 장면 역할별 화면 높이 비율 — hero 는 크게, corner 는 작게 */
const HEIGHT_RATIO: Record<string, number> = {
  hero: 0.52,     // 오프닝·마무리 — 참고 영상처럼 크게 선다
  side: 0.44,
  corner: 0.34,   // 음식이 주인공인 장면 — 옆에서 거든다
};

/**
 * 합성에 쓸 캐릭터 그림을 고른다.
 * 배경이 투명한 컷아웃을 먼저 찾고, 없으면 null (없으면 합성하지 않는다 —
 * 흰 네모가 얹히는 것보다 안 나오는 편이 낫다).
 */
export function cutoutFor(pose: "front" | "side" | "back" = "front"): string | null {
  const roots = [
    // 사용자가 지정한 에셋 폴더 안의 컷아웃
    path.join(orakiAssets().root, "cutout"),
    // 프로그램이 함께 담은 기본 컷아웃
    path.join(DIRS.character, "cutout"),
  ];
  for (const dir of roots) {
    for (const name of [pose, "front", "side"]) {
      const p = path.join(dir, `${name}.png`);
      try { if (fs.statSync(p).isFile()) return p; } catch { /* 다음 후보 */ }
    }
  }
  return null;
}

/** 장면 동작에 어울리는 자세를 고른다 */
export function poseFor(scene: Scene): "front" | "side" | "back" {
  const act = scene.character_action ?? "";
  if (act.includes("걷기") || act.includes("들어가기") || act.includes("골목")) return "side";
  if (act.includes("지도") || act.includes("살펴")) return "side";
  return "front";
}

/**
 * 장면 목록을 받아 어디에 얼마나 크게 얹을지 정한다.
 * 캐릭터가 없는 장면(character_presence === "none")은 건너뛴다.
 */
export function planCharacterOverlays(
  scenes: Scene[],
  /** 한글 판이 얹히는 장면 번호 — 그 장면에서는 캐릭터를 판 아래로 낮춘다 */
  panelScenes: ReadonlySet<number> = new Set(),
): CharacterPlacement[] {
  const out: CharacterPlacement[] = [];
  let idx = 0;
  for (const s of scenes) {
    const presence = s.character_presence;
    if (!presence || presence === "none") continue;

    const img = cutoutFor(poseFor(s));
    if (!img) continue;    // 컷아웃이 없으면 아예 얹지 않는다

    /* 판이 있는 장면은 캐릭터를 낮춰 세운다 — 판·캐릭터·자막이 위에서 아래로 나뉜다 */
    const cap = panelScenes.has(s.scene) ? PANEL_MAX_RATIO : 1;
    const ratio = Math.min(HEIGHT_RATIO[presence] ?? 0.34, cap);
    const height = Math.round(H * ratio);
    /* 컷아웃은 여백을 잘라 낸 세로로 긴 그림이다. 폭은 대략 높이의 0.9 로 본다
       (실제 크기는 ffmpeg 가 scale=-1 로 비율을 지켜 준다 — 여기 값은 좌우 여백 계산용). */
    const width = Math.round(height * 0.9);

    /* 좌우를 번갈아 세운다 — 같은 자리에만 서 있으면 정지 화면처럼 보인다.
       hero(오프닝·마무리)는 가운데에 크게 세워 정면으로 인사하게 한다. */
    const margin = Math.round(W * 0.05);
    const onRight = presence === "hero" ? null : idx % 2 === 0;
    const x = onRight === null
      ? Math.round((W - width) / 2)
      : onRight ? W - width - margin : margin;
    // 발이 자막 위에 닿게 세운다 — 공중에 뜬 것처럼 보이지 않게
    const y = H - SUBTITLE_BAND - height;

    out.push({
      scene: s.scene, imagePath: img, height, x, y,
      flip: onRight === false,   // 왼쪽에 서면 화면 안쪽을 보게 뒤집는다
      start: s.start, end: s.end,
    });
    idx++;
  }
  return out;
}
