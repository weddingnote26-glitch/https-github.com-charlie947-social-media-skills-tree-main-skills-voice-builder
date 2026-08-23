import {
  CAMERA_MOTIONS, ORAKI_ACTIONS, ORAKI_EXPRESSIONS, CONTENT_TYPES,
  type ContentMode,
} from "../schema";

/**
 * AI 응답을 Zod 검증 전에 "고칠 수 있는 건 고치는" 단계.
 *
 * 왜 필요한가: AI가 enum을 살짝 벗어난 값(zoom_in, 음식 가리키기 …)을 하나만 만들어도
 * 대본 전체가 버려지고 제작이 멈춥니다. 의미가 통하는 값은 내부 값으로 맞춰 주고,
 * 도저히 못 맞추면 안전한 기본값으로 떨어뜨려 제작이 계속되게 합니다.
 */

/** 비교용 정규화: 소문자 + 공백/기호 제거 */
function key(s: string): string {
  return s.toLowerCase().replace(/[\s_\-·.]/g, "");
}

/** 2-gram 자카드 유사도 (0~1) */
function similarity(a: string, b: string): number {
  const grams = (s: string) => {
    const t = key(s);
    const set = new Set<string>();
    for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2));
    return set;
  };
  const A = grams(a);
  const B = grams(b);
  if (!A.size || !B.size) return key(a) === key(b) ? 1 : 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}

/** 목록에서 가장 가까운 값 찾기 (정확 → 부분포함 → 유사도) */
function closest<T extends string>(raw: unknown, options: readonly T[], minScore = 0.45): T | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const k = key(raw);
  for (const o of options) if (key(o) === k) return o;
  for (const o of options) if (key(o).includes(k) || k.includes(key(o))) return o;
  let best: T | null = null;
  let bestScore = 0;
  for (const o of options) {
    const s = similarity(raw, o);
    if (s > bestScore) { bestScore = s; best = o; }
  }
  return bestScore >= minScore ? best : null;
}

/** 카메라 움직임 — 못 맞추면 static */
export function normalizeCameraMotion(raw: unknown): (typeof CAMERA_MOTIONS)[number] {
  const exact = closest(raw, CAMERA_MOTIONS, 0.7);
  if (exact) return exact;
  const k = typeof raw === "string" ? key(raw) : "";
  // 순서 주의: 좁은 조건부터 본다. ("closeup" 이 일반 "up" 규칙에 먼저 걸리면 안 됨)
  if (k.includes("zoom")) return k.includes("out") ? "slow_zoom_out" : "slow_zoom_in";
  if (k.includes("closeup") || k.includes("macro") || k.includes("확대")) return "slow_zoom_in";
  if (k.includes("wide") || k.includes("pullback") || k.includes("pullout")) return "slow_zoom_out";
  if (k.includes("pan") || k.includes("track") || k.includes("dolly") || k.includes("slide")) {
    return k.includes("left") ? "pan_left" : "pan_right";
  }
  if (k.includes("tiltup") || k.includes("craneup") || k.includes("moveup") || k.includes("riseup") || k === "up") {
    return "push_up";
  }
  if (k.includes("tiltdown") || k.includes("cranedown") || k.includes("movedown") || k === "down") {
    return "push_down";
  }
  if (k.includes("push")) return k.includes("out") ? "slow_zoom_out" : "slow_zoom_in";
  if (k.includes("still") || k.includes("fixed") || k.includes("고정")) return "static";
  return "static";
}

/** 오락이 행동 — 못 맞추면 null(행동 지정 없음) */
export function normalizeAction(raw: unknown): (typeof ORAKI_ACTIONS)[number] | null {
  if (raw === null || raw === undefined) return null;
  return closest(raw, ORAKI_ACTIONS, 0.4);
}

const EXPRESSION_HINTS: Array<[RegExp, (typeof ORAKI_EXPRESSIONS)[number]]> = [
  [/happy|smile|joy|기쁨|웃/, "Happy"],
  [/shock|놀람|충격/, "Shocked"],
  [/surprise|서프라이즈/, "Surprised"],
  [/excite|신남|들뜬/, "Excited"],
  [/satisf|만족/, "Satisfied"],
  [/think|고민|생각/, "Thinking"],
  [/serious|detective|진지|탐정/, "Serious Detective"],
  [/suspic|의심|수상/, "Suspicious"],
  [/curious|호기심|궁금/, "Curious"],
];

/** 표정 — 못 맞추면 Neutral */
export function normalizeExpression(raw: unknown): (typeof ORAKI_EXPRESSIONS)[number] | null {
  if (raw === null || raw === undefined) return null;
  const exact = closest(raw, ORAKI_EXPRESSIONS, 0.6);
  if (exact) return exact;
  if (typeof raw === "string") {
    for (const [re, val] of EXPRESSION_HINTS) if (re.test(raw.toLowerCase())) return val;
  }
  return "Neutral";
}

const PRESENCES = ["none", "corner", "side", "hero"] as const;

/** 프롬프트가 한국어라 AI가 한국어로 답하는 경우가 있다 */
const PRESENCE_HINTS: Array<[RegExp, (typeof PRESENCES)[number]]> = [
  [/코너|구석|모서리|작게/, "corner"],
  [/옆|측면|side/, "side"],
  [/주인공|중앙|가운데|크게|hero|main/, "hero"],
  [/없|미등장|제외|food only|음식만/, "none"],
];

/** 캐릭터 화면 비중 — 못 맞추면 none (음식 우선) */
export function normalizePresence(raw: unknown): (typeof PRESENCES)[number] {
  const exact = closest(raw, PRESENCES, 0.6);
  if (exact) return exact;
  if (typeof raw === "string") {
    for (const [re, val] of PRESENCE_HINTS) if (re.test(raw.toLowerCase())) return val;
  }
  return "none";
}

export interface NormalizeContext {
  contentType: string;
  contentMode: ContentMode;
  duration: number;
  caseNumber?: number;
  restaurantName: string;
}

type Loose = Record<string, unknown>;

/**
 * AI 원본 JSON → Zod가 통과시킬 수 있는 형태로 정리.
 * 장면 시간은 길이만 살려 처음부터 다시 이어붙여, "시간이 안 이어짐" 오류를 원천 차단합니다.
 */
export function normalizeScriptDraft(raw: unknown, ctx: NormalizeContext): Loose {
  const d: Loose = (raw && typeof raw === "object" && !Array.isArray(raw) ? { ...(raw as Loose) } : {});

  // 요청한 값으로 고정 — AI가 바꿔 놓는 경우가 있음
  d.content_mode = ctx.contentMode;
  d.content_type = closest(d.content_type, CONTENT_TYPES, 0.5) ?? (closest(ctx.contentType, CONTENT_TYPES, 0.5) ?? CONTENT_TYPES[0]);
  d.case_number = ctx.contentMode === "ORAKI_DETECTIVE" ? (ctx.caseNumber ?? null) : null;
  if (!str(d.restaurant)) d.restaurant = ctx.restaurantName;
  if (!str(d.title)) d.title = `${ctx.restaurantName} — ${d.content_type as string}`;
  if (!str(d.target)) d.target = "관악구 40~70대";

  // 장면 정리
  const rawScenes = Array.isArray(d.scenes) ? d.scenes : [];
  const scenes = rawScenes
    .filter((s): s is Loose => !!s && typeof s === "object")
    .slice(0, 10)
    .map((s) => {
      const start = num(s.start);
      const end = num(s.end);
      const planned = end !== null && start !== null && end > start ? end - start : 3;
      return {
        narration: str(s.narration) ?? "",
        subtitle: str(s.subtitle) ?? (str(s.narration) ?? ""),
        visual_prompt: str(s.visual_prompt) ?? "",
        camera_motion: normalizeCameraMotion(s.camera_motion),
        character_action: ctx.contentMode === "ORAKI_DETECTIVE" ? normalizeAction(s.character_action) : null,
        character_expression: ctx.contentMode === "ORAKI_DETECTIVE" ? normalizeExpression(s.character_expression) : null,
        character_presence: ctx.contentMode === "ORAKI_DETECTIVE" ? normalizePresence(s.character_presence) : "none",
        fact_source: str(s.fact_source) ?? "",
        _len: Math.min(8, Math.max(1.2, planned)),
      };
    });

  // 총 길이를 목표에 맞게 비례 조정 (15~60초 밖으로 나가지 않도록)
  const rawTotal = scenes.reduce((a, s) => a + s._len, 0);
  const target = Math.min(60, Math.max(15, ctx.duration));
  const scale = rawTotal > 0 && (rawTotal < 15 || rawTotal > 60) ? target / rawTotal : 1;

  // 시간을 처음부터 다시 이어붙임 → 연속성 오류 원천 차단
  let t = 0;
  d.scenes = scenes.map((s, i) => {
    const len = round1(s._len * scale);
    const start = round1(t);
    const end = round1(t + len);
    t = end;
    const { _len, ...rest } = s;
    void _len;
    return { ...rest, scene: i + 1, start, end };
  });
  d.duration = Math.min(60, Math.max(15, Math.round(t)));

  // 해시태그 3~15개 맞추기
  const tags = (Array.isArray(d.hashtags) ? d.hashtags : [])
    .map((x) => (typeof x === "string" ? (x.startsWith("#") ? x : `#${x}`) : null))
    .filter((x): x is string => !!x && x.length > 1);
  const fallbackTags = ["#오락푸드", "#관악구맛집", "#서울맛집"];
  for (const f of fallbackTags) if (tags.length < 3 && !tags.includes(f)) tags.push(f);
  d.hashtags = tags.slice(0, 15);

  if (!str(d.hook)) d.hook = str((d.scenes as Loose[])[0]?.narration) ?? `${ctx.restaurantName}, 그냥 지나치면 안 됩니다.`;
  if (!str(d.cta)) d.cta = "다음에 갈 곳으로 저장해두세요.";
  if (!str(d.caption)) d.caption = "";

  // 오락이 모드는 탐정 판정이 필수
  if (ctx.contentMode === "ORAKI_DETECTIVE") {
    const v = (d.verdict && typeof d.verdict === "object" ? { ...(d.verdict as Loose) } : {}) as Loose;
    v.label = "오락이 탐정 판정";
    for (const k of ["가성비", "맛", "양", "재방문"]) {
      const n = num(v[k]);
      v[k] = n === null ? 4 : Math.min(5, Math.max(1, Math.round(n)));
    }
    if (!str(v.한줄판정)) v.한줄판정 = "재방문 가능성 높음.";
    d.verdict = v;
  } else {
    d.verdict = null;
  }

  if (!Array.isArray(d.fact_check)) d.fact_check = [];
  if (num(d.quality_score) === null) d.quality_score = 0;
  return d;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : null;
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
