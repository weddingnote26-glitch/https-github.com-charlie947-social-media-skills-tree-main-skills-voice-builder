import { db, j } from "./db";
import { newId } from "./id";
import { RestaurantInfoSchema, type RestaurantInfo, type FactCheckItem } from "./schema";
import { runFactCheck } from "./pipeline/factcheck";
import { getReel, updateReel } from "./reels";

export type FieldStatus = "확인" | "미확인" | "사용자 입력";

/** 수기 입력 화면이 다루는 항목. 화면·저장·상태표시가 모두 이 목록 하나만 본다. */
export const MANUAL_FIELDS = [
  "name", "area", "source_url", "address", "phone", "map_url",
  "menus", "hours", "closed_days", "parking", "reservation", "review_summary",
] as const;
export type ManualField = (typeof MANUAL_FIELDS)[number];

/** 화면이 그대로 쓰는 입력 폼 값 (메뉴는 여러 줄 글자로 주고받는다) */
export interface RestaurantForm {
  id: string;
  name: string; area: string; source_url: string; address: string; phone: string; map_url: string;
  menus_text: string; hours: string; closed_days: string; parking: string; reservation: string;
  review_summary: string;
  field_status: Record<string, FieldStatus>;
}

export interface ManualPatch {
  id?: string;
  name?: string; area?: string; source_url?: string; address?: string; phone?: string; map_url?: string;
  menus_text?: string; hours?: string; closed_days?: string; parking?: string; reservation?: string;
  review_summary?: string;
}

export interface MenuItem { name: string; price: string; verified: boolean }

/** 값 하나짜리 가격 또는 "6,000~8,000원" 같은 범위 */
const PRICE = String.raw`[0-9][0-9,._]*(?:\s*[~-]\s*[0-9][0-9,._]*)?\s*(?:원)?`;
/** 사람이 일부러 나눈 자리 — 쉼표는 천 단위 구분에도 쓰이므로 여기 넣지 않는다 */
const EXPLICIT = new RegExp(String.raw`^(.*\S)\s*[|\t]\s*(\S.*)$`);
/** 줄 끝에 붙은 가격. 이름은 최소로 잡아야 "왕만두 6,000원" 의 쉼표에서 잘리지 않는다 */
const TAIL = new RegExp(String.raw`^(.*?\S)\s*[\s,\-]\s*(${PRICE})$`);

/**
 * 사람이 편하게 적은 메뉴 줄을 {이름, 가격} 으로 나눈다.
 * "왕만두 6,000원" / "왕만두 | 6000" / "왕만두, 6000" / "왕만두 - 6000" 모두 받는다.
 * 가격을 못 찾으면 이름만 남기고 verified=false (가격 미확인) 로 둔다.
 */
export function parseMenuLines(text: string): MenuItem[] {
  const out: MenuItem[] = [];
  for (const raw of (text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const explicit = EXPLICIT.exec(line);
    if (explicit) { out.push({ name: explicit[1].trim(), price: explicit[2].trim(), verified: true }); continue; }
    const tail = TAIL.exec(line);
    if (tail) { out.push({ name: tail[1].replace(/[,\-\s]+$/, "").trim(), price: tail[2].trim(), verified: true }); continue; }
    out.push({ name: line, price: "", verified: false });
  }
  return out.filter((m) => m.name);
}

/** 저장된 메뉴를 다시 사람이 고칠 수 있는 여러 줄 글자로 되돌린다 */
export function menuLines(menus: MenuItem[]): string {
  return menus.map((m) => (m.price ? `${m.name} | ${m.price}` : m.name)).join("\n");
}

interface RestaurantRow extends Record<string, string> { id: string }

function rowOf(id: string): RestaurantRow | undefined {
  return db().prepare("SELECT * FROM restaurants WHERE id=?").get(id) as RestaurantRow | undefined;
}

function infoOfRow(r: RestaurantRow): RestaurantInfo {
  return RestaurantInfoSchema.parse({
    name: r.name, area: r.area, address: r.address ?? "", phone: r.phone ?? "",
    map_url: r.map_url ?? "", source_url: r.source_url ?? "",
    menus: j(r.menus_json, []), hours: r.hours ?? "", closed_days: r.closed_days ?? "",
    parking: r.parking ?? "", reservation: r.reservation ?? "",
    features: j(r.features_json, []), review_summary: r.review_summary ?? "",
    pros: j(r.pros_json, []), cons: j(r.cons_json, []),
    recommended_for: r.recommended_for ?? "", field_status: j(r.field_status_json, {}),
  });
}

/** 저장된 맛집 한 곳을 읽는다. 없으면 null. */
export function readRestaurant(id: string): (RestaurantInfo & { id: string }) | null {
  const r = rowOf(id);
  return r ? { id: r.id, ...infoOfRow(r) } : null;
}

/** 화면 입력 폼 모양으로 바꾼다 */
export function toForm(id: string, info: RestaurantInfo): RestaurantForm {
  return {
    id,
    name: info.name, area: info.area, source_url: info.source_url, address: info.address,
    phone: info.phone, map_url: info.map_url, menus_text: menuLines(info.menus),
    hours: info.hours, closed_days: info.closed_days, parking: info.parking,
    reservation: info.reservation, review_summary: info.review_summary,
    field_status: info.field_status as Record<string, FieldStatus>,
  };
}

/** 릴스 화면이 바로 쓰는 폼 값 (맛집이 연결돼 있지 않으면 null) */
export function restaurantForm(id: string | null | undefined): RestaurantForm | null {
  if (!id) return null;
  const info = readRestaurant(id);
  return info ? toForm(id, info) : null;
}

const COLUMN: Record<ManualField, string> = {
  name: "name", area: "area", source_url: "source_url", address: "address", phone: "phone",
  map_url: "map_url", menus: "menus_json", hours: "hours", closed_days: "closed_days",
  parking: "parking", reservation: "reservation", review_summary: "review_summary",
};

/**
 * 사람이 직접 적은 업체 정보를 저장한다.
 *
 * - 폼이 보내지 않은 항목(undefined)은 건드리지 않는다. 기존 값을 지우지 않기 위해서다.
 * - 값이 들어오면 그 항목을 "사용자 입력" 으로 표시한다. 자동 수집이 실패해도
 *   사장님이 매장에서 보고 적은 값이 가장 정확한 출처다.
 * - 일부러 비운 항목은 다시 "미확인" 으로 돌린다. 빈 칸은 저장은 되지만 확인 필요로 남는다.
 */
export function saveManualRestaurant(patch: ManualPatch): { id: string; form: RestaurantForm; marked: ManualField[] } {
  const d = db();
  const existing = patch.id ? rowOf(patch.id) : undefined;
  if (patch.id && !existing) throw new Error("맛집을 찾을 수 없습니다");

  if (patch.name !== undefined && !patch.name.trim()) throw new Error("매장명은 비울 수 없습니다");
  if (!existing && !patch.name?.trim()) throw new Error("새 업체를 등록하려면 매장명이 필요합니다");

  const id = existing?.id ?? newId("rest");
  const info = existing ? infoOfRow(existing) : RestaurantInfoSchema.parse({ name: patch.name!.trim() });
  const status: Record<string, FieldStatus> = { ...(info.field_status as Record<string, FieldStatus>) };
  const sets: string[] = [];
  const params: Record<string, unknown> = { id };
  const marked: ManualField[] = [];

  const put = (field: ManualField, value: string, stored: unknown) => {
    sets.push(`${COLUMN[field]}=@${field}`);
    params[field] = stored;
    // 빈 칸으로 지우면 이전에 "확인" 이었더라도 확인 필요로 되돌린다.
    // 값이 없는데 확인됐다고 남겨 두면 팩트체크가 빈 값을 통과시킨다.
    if (value.trim()) { status[field] = "사용자 입력"; marked.push(field); }
    else status[field] = "미확인";
  };

  for (const field of MANUAL_FIELDS) {
    if (field === "menus") {
      if (patch.menus_text === undefined) continue;
      put("menus", patch.menus_text, JSON.stringify(parseMenuLines(patch.menus_text)));
      continue;
    }
    const v = patch[field];
    if (v === undefined) continue;
    put(field, v, v.trim());
  }

  params.field_status_json = JSON.stringify(status);
  sets.push("field_status_json=@field_status_json");

  if (existing) {
    d.prepare(`UPDATE restaurants SET ${sets.join(", ")}, updated_at=datetime('now') WHERE id=@id`).run(params);
  } else {
    d.prepare(`INSERT INTO restaurants (id, name, area, field_status_json) VALUES (@id, @name0, @area0, '{}')`)
      .run({ id, name0: info.name, area0: info.area });
    d.prepare(`UPDATE restaurants SET ${sets.join(", ")}, updated_at=datetime('now') WHERE id=@id`).run(params);
  }

  const saved = readRestaurant(id);
  if (!saved) throw new Error("저장한 업체 정보를 다시 읽지 못했습니다");
  return { id, form: toForm(id, saved), marked };
}

/* ── 같은 가게가 여러 번 등록되는 문제 ─────────────────────────
   예전에는 이름과 지역이 "글자까지 똑같을 때만" 같은 가게로 봤다.
   AI 조사가 매번 조금씩 다르게 돌려주니
     신림동 막불감동 / 관악구
     신림동 막불감동 / 신림
     신림 막불감동   / 신림
   이 전부 다른 가게로 쌓였다.

   그래서 두 단계로 나눈다.
   1) 이름만 다듬어서 똑같으면 같은 가게로 본다 (지역은 보지 않는다)
   2) 한두 글자 차이면 자동으로 합치지 않고 화면에서 물어본다
      — 진짜 다른 가게를 마음대로 합치면 안 된다 */

/** 비교용으로 이름을 다듬는다 — 공백·기호를 없애고 소문자로 */
export function normalizeName(name: string): string {
  return (name ?? "").normalize("NFC").replace(/[\s·・.,'"“”‘’()\[\]-]+/g, "").toLowerCase();
}

/** 글자 하나를 넣고·빼고·바꿔 몇 번 만에 같아지는지 (Levenshtein) */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length || !b.length) return Math.max(a.length, b.length);
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length];
}

/** 두 이름이 "같은 가게로 볼 만큼" 비슷한가 — 자동 합치기가 아니라 물어보기용 */
export function looksSimilar(a: string, b: string): boolean {
  const x = normalizeName(a), y = normalizeName(b);
  if (!x || !y || x === y) return false;                 // 같은 건 여기서 다루지 않는다
  if (Math.min(x.length, y.length) < 3) return false;    // 너무 짧으면 우연히 비슷해진다
  const allow = x.length >= 8 || y.length >= 8 ? 2 : 1;
  return editDistance(x, y) <= allow;
}

/** 이름이 다듬어서 같은 업체를 찾는다 (지역은 보지 않는다) */
export function findByName(name: string): (RestaurantInfo & { id: string }) | null {
  const key = normalizeName(name);
  if (!key) return null;
  const rows = db().prepare("SELECT id, name FROM restaurants WHERE deleted_at IS NULL").all() as Array<{ id: string; name: string }>;
  const hit = rows.find((r) => normalizeName(r.name) === key);
  return hit ? readRestaurant(hit.id) : null;
}

/** 헷갈릴 만큼 비슷한 이름의 업체들 — 화면에서 "혹시 이 가게인가요?" 로 쓴다 */
export function similarRestaurants(name: string, excludeId?: string): Array<{ id: string; name: string; area: string }> {
  const rows = db().prepare("SELECT id, name, area FROM restaurants WHERE deleted_at IS NULL").all() as Array<{ id: string; name: string; area: string }>;
  return rows.filter((r) => r.id !== excludeId && looksSimilar(name, r.name));
}

export interface RestaurantBrief {
  id: string; name: string; area: string; address: string; phone: string;
  menuSummary: string; confirmed: number; total: number; updated_at: string;
}

/**
 * 맛집 DB 목록 — 화면의 [맛집 DB에서 불러오기] 가 쓴다.
 * 검색어는 업체명·주소·전화번호·지역에서 찾는다.
 */
export function searchRestaurants(q = "", limit = 50): RestaurantBrief[] {
  const rows = db().prepare("SELECT * FROM restaurants WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 500").all() as RestaurantRow[];
  const needle = normalizeName(q);
  const out: RestaurantBrief[] = [];
  for (const r of rows) {
    if (needle) {
      const hay = normalizeName([r.name, r.address, r.phone, r.area].filter(Boolean).join(" "));
      if (!hay.includes(needle)) continue;
    }
    const menus = j<MenuItem[]>(r.menus_json, []);
    const st = j<Record<string, string>>(r.field_status_json, {});
    const values = Object.values(st);
    out.push({
      id: r.id, name: r.name, area: r.area ?? "", address: r.address ?? "", phone: r.phone ?? "",
      menuSummary: menus.map((m) => `${m.name} ${m.price}`.trim()).join(", "),
      confirmed: values.filter((v) => v === "확인" || v === "사용자 입력").length,
      total: values.length || MANUAL_FIELDS.length,
      updated_at: r.updated_at ?? "",
    });
    if (out.length >= limit) break;
  }
  return out;
}

export interface RecheckResult { reelId: string; blocked: boolean; reasons: string[]; confirmed: number; total: number }

/**
 * 업체 정보를 고치면 그 업체로 만든 릴스의 팩트체크를 다시 돌린다.
 * 손으로 채워 넣은 값 덕분에 막혀 있던 발행이 풀릴 수 있어야 한다.
 */
export function recheckReelsOfRestaurant(restaurantId: string): RecheckResult[] {
  const info = readRestaurant(restaurantId);
  if (!info) return [];
  const rows = db().prepare("SELECT id FROM reels WHERE restaurant_id=?").all(restaurantId) as Array<{ id: string }>;
  const out: RecheckResult[] = [];
  for (const { id } of rows) {
    const reel = getReel(id);
    if (!reel?.script) continue;
    const script = { ...reel.script, scenes: reel.scenes.length ? reel.scenes : reel.script.scenes };
    const fact = runFactCheck(script, info);
    const quality = j<Record<string, unknown>>(reel.quality_json, {});
    updateReel(id, {
      factcheck_json: JSON.stringify(fact.items),
      quality_json: JSON.stringify({ ...quality, fact_blocked: fact.blocked, fact_block_reasons: fact.blockReasons }),
    });
    out.push({
      reelId: id, blocked: fact.blocked, reasons: fact.blockReasons,
      confirmed: fact.items.filter((i: FactCheckItem) => i.status !== "미확인").length,
      total: fact.items.length,
    });
  }
  return out;
}
