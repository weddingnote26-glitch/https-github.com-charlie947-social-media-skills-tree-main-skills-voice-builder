import { db, j } from "../db";
import { CONTENT_TYPES, CONTENT_MODES, type ContentMode, type WeeklyItem } from "../schema";
import { getSettings } from "../settings";

export const AREAS = ["신림", "봉천", "서울대입구", "낙성대", "관악구"] as const;

const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"] as const;

/** §7 콘텐츠 유형 자동 순환 — 최근 게시물과 같은 주제가 연속되지 않도록 */
export function pickContentType(excludeRecent = 3): (typeof CONTENT_TYPES)[number] {
  const rows = db().prepare(
    "SELECT content_type FROM reels ORDER BY created_at DESC LIMIT ?"
  ).all(excludeRecent) as Array<{ content_type: string }>;
  const recent = new Set(rows.map((r) => r.content_type));
  const candidates = CONTENT_TYPES.filter((t) => !recent.has(t));
  const pool = candidates.length ? candidates : [...CONTENT_TYPES];
  // 사용 빈도가 낮은 유형 우선
  const counts = db().prepare(
    "SELECT content_type, COUNT(*) AS c FROM reels GROUP BY content_type"
  ).all() as Array<{ content_type: string; c: number }>;
  const countMap = new Map(counts.map((r) => [r.content_type, r.c]));
  return [...pool].sort((a, b) => (countMap.get(a) ?? 0) - (countMap.get(b) ?? 0))[0];
}

/** §27 캐릭터 모드 선택 — 주 6개 중 기본 4개 오락이 / 2개 일반 (관리자 조정 가능) */
export function pickContentMode(indexInWeek: number): ContentMode {
  const orakiPerWeek = getSettings().orakiPerWeek;
  // 오락이 회차를 주 안에서 고르게 분산 (예: 4/6 → 월화 수(일반) 목금 토(일반))
  const ratio = orakiPerWeek / 6;
  const orakiCount = Math.round((indexInWeek + 1) * ratio) - Math.round(indexInWeek * ratio);
  return orakiCount > 0 ? CONTENT_MODES[1] : CONTENT_MODES[0];
}

function localISO(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 이번 주 월요일 — 일요일(휴무)에는 다가오는 새 주를 기준으로 */
export function mondayOf(date = new Date()): string {
  const d = new Date(date);
  if (d.getDay() === 0) d.setDate(d.getDate() + 1);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return localISO(d);
}

/** §29 주간 6개 기획안 생성 (월~토) */
export function buildWeeklyPlan(weekStart?: string): WeeklyItem[] {
  const start = weekStart ?? mondayOf();
  const settings = getSettings();
  const dayKeys = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
  const items: WeeklyItem[] = [];
  const usedTypes = new Set<string>();
  let i = 0;
  for (let d = 0; d < 7; d++) {
    const date = new Date(start + "T00:00:00");
    date.setDate(date.getDate() + d);
    const iso = localISO(date);
    const dayKey = dayKeys[d];
    if (!settings.publishDays[dayKey]) continue; // 기본: 일요일 휴무 (§34)
    // 유형: 미사용 우선 + 지역 순환
    let type = pickContentType(usedTypes.size);
    if (usedTypes.has(type)) {
      const alt = CONTENT_TYPES.find((t) => !usedTypes.has(t));
      if (alt) type = alt;
    }
    usedTypes.add(type);
    items.push({
      date: iso,
      weekday: WEEKDAY_KO[date.getDay()],
      content_type: type,
      content_mode: pickContentMode(i),
      area: AREAS[i % AREAS.length],
      restaurant_hint: "",
      reel_id: null,
      status: "기획",
    });
    i++;
  }
  return items;
}

/** 대시보드 주간 현황 */
export function weekOverview(): Array<{ date: string; weekday: string; reels: Array<{ id: string; title: string; status: string }> }> {
  const start = mondayOf();
  const out: Array<{ date: string; weekday: string; reels: Array<{ id: string; title: string; status: string }> }> = [];
  for (let d = 0; d < 6; d++) {
    const date = new Date(start + "T00:00:00");
    date.setDate(date.getDate() + d);
    const iso = localISO(date);
    const rows = db().prepare(
      "SELECT id, title, status FROM reels WHERE planned_date=? ORDER BY created_at"
    ).all(iso) as Array<{ id: string; title: string; status: string }>;
    out.push({ date: iso, weekday: WEEKDAY_KO[date.getDay()], reels: rows });
  }
  return out;
}

/** §28 중복 검사 — 최근 콘텐츠와 제목/HOOK/CTA/대본 유사도 */
export function similarityAgainstRecent(candidate: { title: string; hook: string; cta: string; narrations: string[] }, limit = 10, excludeReelId?: string): {
  maxScore: number; against?: string;
} {
  const rows = (db().prepare(
    "SELECT id, title, script_json FROM reels ORDER BY created_at DESC LIMIT ?"
  ).all(limit) as Array<{ id: string; title: string; script_json: string }>)
    .filter((r) => r.id !== excludeReelId);
  let maxScore = 0;
  let against: string | undefined;
  for (const r of rows) {
    const s = j<{ hook?: string; cta?: string; scenes?: Array<{ narration: string }> }>(r.script_json, {});
    const fields = [
      [candidate.title, r.title ?? ""],
      [candidate.hook, s.hook ?? ""],
      [candidate.cta, s.cta ?? ""],
      [candidate.narrations.join(" "), (s.scenes ?? []).map((x) => x.narration).join(" ")],
    ] as const;
    const weights = [0.2, 0.3, 0.15, 0.35];
    let score = 0;
    fields.forEach(([a, b], idx) => { score += weights[idx] * bigramSimilarity(a, b); });
    if (score > maxScore) { maxScore = score; against = r.id; }
  }
  return { maxScore, against };
}

/** 2-gram 자카드 유사도 (0~1) */
export function bigramSimilarity(a: string, b: string): number {
  const grams = (s: string) => {
    // 예전 대본 기록에 값이 비어 있는 줄이 섞여 있어도 제작이 멈추면 안 된다
    const t = String(s ?? "").replace(/\s+/g, "");
    const set = new Set<string>();
    for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2));
    return set;
  };
  const A = grams(a); const B = grams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}
