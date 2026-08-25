/**
 * 한글 간판·메뉴판·정보판을 **프로그램이** 영상에 합성한다.
 *
 * 왜 이렇게 하나:
 *   이미지 생성 AI 는 한글을 거의 항상 깨뜨린다. 실제로 간판에 영어·일본어·
 *   뜻 없는 글자가 찍혀 나왔다. 그래서 배경은 글자 없이 그리게 하고(scene-prompt.ts),
 *   글자는 여기서 한글 폰트로 얹는다. 이 방식이라야 업체명과 가격이 정확하다.
 *
 * 지키는 규칙:
 *   - 확인되지 않은 값은 화면에 쓰지 않는다. 특히 가격은 지어내지 않는다.
 *   - 사장님이 직접 적어 넣은 값("사용자 입력")은 확인된 값으로 본다.
 *   - 넣을 내용이 없으면 판을 아예 만들지 않는다 (빈 판을 띄우지 않는다).
 */
import type { Scene, RestaurantInfo } from "../schema";

export type OverlayKind = "signboard" | "menu" | "info";

export interface Overlay {
  /** 어느 장면 위에 얹는가 */
  scene: number;
  kind: OverlayKind;
  /** 첫 줄 — 제목(업체명 등) */
  title: string;
  /** 이어지는 줄들 */
  lines: string[];
  start: number;
  end: number;
}

/** 가격을 확인하지 못했을 때 화면에 쓰는 문구 — 임의 가격을 만들지 않는다 */
export const PRICE_UNKNOWN = "가격은 매장에서 확인해 주세요";

/** 사장님이 직접 적은 값도 확인된 값으로 센다 */
function verified(info: RestaurantInfo, field: string): boolean {
  const st = info.field_status?.[field];
  return st === "확인" || st === "사용자 입력";
}

/** 확인된 값만 돌려준다. 못 믿을 값이면 빈 문자열 */
function trusted(info: RestaurantInfo, field: keyof RestaurantInfo & string): string {
  const raw = String(info[field] ?? "").trim();
  if (!raw) return "";
  return verified(info, field) ? raw : "";
}

/** 화면에 얹을 글이 너무 길면 잘라 준다 (5070 사용자가 읽을 수 있는 길이) */
export function clip(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length <= max ? t : t.slice(0, max - 1) + "…";
}

export interface OverlayOptions {
  /** 정보를 확인한 날 — 화면에 함께 적어 "언제 기준인지" 를 밝힌다 */
  checkedOn?: string;
  /** 캐릭터 이름표를 간판에 함께 넣을지 */
  brandLine?: string;
}

/**
 * 장면 목록과 업체 정보로 얹을 판을 정한다.
 *
 * 어느 장면에 무엇을 얹을지는 장면의 역할로 고른다.
 *   첫 장면      → 간판 (업체명)
 *   메뉴 장면    → 메뉴판 (대표 메뉴 + 확인된 가격)
 *   정보 장면    → 정보판 (영업시간·휴무·주차·예약)
 */
export function buildOverlays(
  scenes: Scene[],
  info: RestaurantInfo,
  opts: OverlayOptions = {},
): Overlay[] {
  if (!scenes.length) return [];
  const out: Overlay[] = [];
  /* 한 장면에 판이 두 개 겹치면 화면이 읽히지 않는다 — 쓴 장면은 표시해 둔다 */
  const taken = new Set<number>();

  // ── 간판: 첫 장면. 업체명은 사람이 넣은 값이라 언제나 정확하다 ──
  const first = scenes[0];
  out.push({
    scene: first.scene,
    kind: "signboard",
    title: clip(info.name, 18),
    lines: [opts.brandLine ?? "만두탐정 오락이의 맛집 조사"],
    start: first.start,
    end: Math.min(first.end, first.start + 3.5),
  });
  taken.add(first.scene);

  // ── 메뉴판: 대표 메뉴가 있는 장면 ──
  const menuScene = pickScene(scenes, ["메뉴", "가격", "원", "만두", "요리", "한 그릇"], taken)
    ?? fallbackScene(scenes, taken);
  const menus = info.menus.filter((m) => m.name.trim()).slice(0, 3);
  if (menuScene && menus.length) {
    const lines = menus.map((m) => {
      const price = m.price.trim();
      // 확인 안 된 가격은 쓰지 않는다 — 지어낸 가격이 영상에 박히면 되돌릴 수 없다
      return price && m.verified ? `${clip(m.name, 12)}  ${price}` : clip(m.name, 12);
    });
    if (menus.some((m) => !m.verified || !m.price.trim())) lines.push(PRICE_UNKNOWN);
    out.push({
      scene: menuScene.scene, kind: "menu", title: "대표 메뉴", lines,
      start: menuScene.start, end: menuScene.end,
    });
    taken.add(menuScene.scene);
  }

  // ── 정보판: 영업시간 등이 확인된 경우에만 ──
  const infoScene = pickScene(scenes, ["영업", "시간", "휴무", "주차", "예약", "정보"], taken)
    ?? fallbackScene(scenes, taken);
  const infoLines: string[] = [];
  const hours = trusted(info, "hours");
  const closed = trusted(info, "closed_days");
  const parking = trusted(info, "parking");
  const reservation = trusted(info, "reservation");
  if (hours) infoLines.push(`영업시간  ${clip(hours, 20)}`);
  if (closed) infoLines.push(`휴무  ${clip(closed, 20)}`);
  if (parking) infoLines.push(`주차  ${clip(parking, 20)}`);
  if (reservation) infoLines.push(`예약  ${clip(reservation, 20)}`);
  if (infoScene && infoLines.length) {
    if (opts.checkedOn) infoLines.push(`확인일  ${opts.checkedOn}`);
    out.push({
      scene: infoScene.scene, kind: "info", title: "이용 정보", lines: infoLines,
      start: infoScene.start, end: infoScene.end,
    });
    taken.add(infoScene.scene);
  }

  return out;
}

/**
 * 그 낱말이 나오는 장면을 고른다. 없으면 null.
 *
 * 실제로 겪은 문제: 첫 프레임에 간판·메뉴판·정보판이 한꺼번에 겹쳐 나왔다.
 * 원인은 두 가지였다.
 *   - visual_prompt(영어)까지 뒤져서 "menu board" 같은 배경 묘사에 걸렸다
 *   - 이미 간판을 얹은 첫 장면이 다시 뽑혔다
 * 그래서 사람이 듣는 말(자막·나레이션)만 보고, 이미 쓴 장면은 건너뛴다.
 */
function pickScene(scenes: Scene[], words: string[], taken: Set<number>): Scene | null {
  for (const s of scenes) {
    if (taken.has(s.scene)) continue;
    const hay = `${s.subtitle} ${s.narration}`.toLowerCase();
    if (words.some((w) => hay.includes(w.toLowerCase()))) return s;
  }
  return null;
}

/**
 * 낱말로 못 찾았을 때 쓸 자리.
 * 확인된 영업시간·가격을 화면에 못 올리고 버리는 편보다,
 * 아직 비어 있는 뒤쪽 장면에라도 올리는 편이 사용자에게 쓸모 있다.
 * (첫 장면은 간판 자리라 건너뛴다)
 */
function fallbackScene(scenes: Scene[], taken: Set<number>): Scene | null {
  for (let i = scenes.length - 1; i >= 1; i--) {
    if (!taken.has(scenes[i].scene)) return scenes[i];
  }
  return null;
}
