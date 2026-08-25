/**
 * 오락이 공식 에셋 폴더.
 *
 * 사용자가 바탕화면 등에 따로 관리하는 폴더(master / turnaround / actions)를
 * 설정에서 가리키면 그쪽을 쓰고, 없으면 프로그램에 함께 담긴 기본 에셋을 쓴다.
 *
 * ▸ 이 파일은 **읽기만 한다.** 원본을 고치거나 덮어쓰거나 지우지 않는다.
 *   공식 에셋은 캐릭터 정체성의 원본이라 프로그램이 손대면 안 된다.
 * ▸ 설정한 폴더가 없는 PC(집·회사)에서도 제작이 멈추지 않도록 기본 에셋으로 내려간다.
 */
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { DIRS } from "../paths";
import { getSettings } from "../settings";

export interface OrakiAssets {
  /** 실제로 쓰는 폴더 */
  root: string;
  /** 설정 폴더를 쓰는지, 기본 제공으로 내려왔는지 */
  source: "설정 폴더" | "기본 제공";
  /** 절대 마스터 — 캐릭터 생성의 기준. 없으면 캐릭터 장면을 만들지 않는다 */
  master: string | null;
  /** 정면 운영 기준 */
  front: string | null;
  /** 각도 기준 (turnaround) */
  turnaround: string[];
  /** 행동 기준 (actions) */
  actions: string[];
  /**
   * 에셋 묶음의 판(version). 캐시 키에 넣는다.
   * 에셋을 바꾸면 값이 달라져 옛 이미지를 재사용하지 않게 된다.
   */
  version: string;
}

const IMG = /\.(png|jpe?g|webp)$/i;

function listImages(dir: string): string[] {
  try {
    return fs.readdirSync(dir)
      .filter((f) => IMG.test(f))
      .sort()
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

function firstExisting(...candidates: string[]): string | null {
  for (const c of candidates) {
    try { if (fs.existsSync(c) && fs.statSync(c).isFile()) return c; } catch { /* 다음 후보 */ }
  }
  return null;
}

/** 파일 내용을 읽지 않고 크기·수정시각만으로 판을 만든다 (큰 파일도 빠르게) */
function stamp(files: Array<string | null>): string {
  const h = crypto.createHash("sha256");
  for (const f of files) {
    if (!f) { h.update("-"); continue; }
    try {
      const st = fs.statSync(f);
      h.update(`${path.basename(f)}:${st.size}:${Math.round(st.mtimeMs)}`);
    } catch {
      h.update(`${f}:none`);
    }
  }
  return h.digest("hex").slice(0, 12);
}

/** 설정에 적힌 폴더가 쓸 만한지 (있고, 폴더이고, 이미지가 하나라도 있는지) */
function usable(root: string): boolean {
  if (!root.trim()) return false;
  try {
    if (!fs.statSync(root).isDirectory()) return false;
  } catch {
    return false;
  }
  return (
    listImages(root).length > 0 ||
    listImages(path.join(root, "master")).length > 0 ||
    listImages(path.join(root, "turnaround")).length > 0 ||
    listImages(path.join(root, "actions")).length > 0
  );
}

/** 마스터로 인정하는 파일 자리 — 안내 문구와 시험에서 함께 쓴다 */
export function masterCandidates(root: string): string[] {
  return [
    path.join(root, "oraki_detective.png"),
    path.join(root, "master", "oraki_detective.png"),
    path.join(root, "master", "oraki_master.png"),
    path.join(root, "character_sheet.png"),
    path.join(root, "front.png"),
  ];
}

export function orakiAssets(): OrakiAssets {
  const configured = (getSettings().characterLock.assetRoot ?? "").trim();
  const useConfigured = usable(configured);
  const root = useConfigured ? configured : DIRS.character;

  const turnDir = path.join(root, "turnaround");
  const actionDir = path.join(root, "actions");

  /* 마스터 후보 순서.
     oraki_detective.png 는 사용자가 지정한 공식 마스터 파일이라 가장 먼저 본다.
     설정 폴더뿐 아니라 프로그램이 함께 담은 자리도 훑는다 — 어느 PC 에서든 찾게. */
  const master = firstExisting(
    path.join(root, "oraki_detective.png"),
    path.join(root, "master", "oraki_detective.png"),
    path.join(root, "master", "oraki_master.png"),
    ...listImages(path.join(root, "master")),
    // 기본 제공 에셋에는 master 폴더가 없다 — 전체 시트를 마스터로 본다
    path.join(root, "character_sheet.png"),
    path.join(root, "front.png"),
  );
  const front = firstExisting(
    path.join(turnDir, "oraki_front.png"),
    path.join(root, "front.png"),
  );
  const turnaround = listImages(turnDir);
  const actions = listImages(actionDir);

  return {
    root,
    source: useConfigured ? "설정 폴더" : "기본 제공",
    master,
    front,
    turnaround,
    actions,
    version: stamp([master, front, ...turnaround.slice(0, 4), ...actions.slice(0, 4)]),
  };
}

/**
 * 캐릭터 장면에 넘길 기준 이미지.
 * 마스터를 맨 앞에 두고, 각도·행동 기준을 한 장씩 곁들인다 (최대 3장 — 요청이 커지면 느리고 비싸다).
 */
export function characterReferences(a: OrakiAssets = orakiAssets()): string[] {
  const picked = [a.master, a.front, a.turnaround[0] ?? a.actions[0] ?? null];
  return picked.filter((p): p is string => !!p).filter((p, i, arr) => arr.indexOf(p) === i).slice(0, 3);
}

/** 마스터가 없으면 어디를 봐야 하는지까지 알려준다 (§오류 처리) */
export function masterMissingReason(a: OrakiAssets = orakiAssets()): string | null {
  if (a.master) return null;
  const looked = masterCandidates(a.root).slice(0, 3).map((c) => `  · ${c}`).join("\n");
  const where = `${a.source === "설정 폴더" ? "설정한" : "기본"} 에셋 폴더에서 만두탐정 오락이 기준 이미지를 찾지 못했습니다.\n`
    + `oraki_detective.png 파일을 아래 자리에 두거나, 설정에서 파일을 골라 주세요.\n찾아본 곳:\n${looked}`;
  return `${where}\n오락이가 나오는 장면은 마스터 이미지 없이 만들지 않습니다 — 얼굴이 매번 달라지기 때문입니다.`;
}
