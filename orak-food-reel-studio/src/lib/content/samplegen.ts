import type { LLMTask } from "../providers/types";
import type { RestaurantInfo, ReelScript, Scene } from "../schema";
import { caseLabel, pickVerdictPhrase, SCENE_ROLE_MAP } from "../character/oraki";
import { orakiImagePrompt } from "../character/oraki";

/**
 * Sample Mode 로컬 생성기 (§50) — API 키 없이 대본→장면→자막→캡션 흐름 검증.
 * 결정적(같은 입력 → 같은 출력)으로 동작한다.
 */

export interface ScriptGenContext {
  info: RestaurantInfo;
  contentType: string;
  contentMode: "NORMAL_FOOD" | "ORAKI_DETECTIVE";
  duration: number;
  caseNumber?: number;
}

export function sampleComplete(task: LLMTask, context?: unknown): string {
  switch (task) {
    case "script":
      return JSON.stringify(buildSampleScript(context as ScriptGenContext));
    case "research":
      return JSON.stringify(sampleResearch(context as { name?: string; area?: string }));
    case "caption": {
      const c = context as ScriptGenContext;
      return buildSampleCaption(c.info, c.contentType);
    }
    case "idea":
      return JSON.stringify({ note: "샘플 기획", angles: ["가성비", "대표 메뉴", "혼밥"] });
    case "benchmark":
      return JSON.stringify(sampleBenchmark());
    case "revision":
      return JSON.stringify(context ?? {});
    case "verdict":
      return JSON.stringify({ 한줄판정: "재방문 가능성 높음." });
    default:
      return "{}";
  }
}

function seedFrom(s: string): number {
  let h = 7;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

/** 유효한 ReelScript를 로컬에서 조립 */
export function buildSampleScript(ctx: ScriptGenContext): ReelScript {
  const { info, contentType, contentMode, duration } = ctx;
  const seed = seedFrom(info.name + contentType);
  const menu = info.menus[0]?.name || "대표 메뉴";
  const price = info.menus[0]?.verified && info.menus[0]?.price ? info.menus[0].price : "";
  const area = info.area || "신림";

  const isOraki = contentMode === "ORAKI_DETECTIVE";
  const hooks = isOraki
    ? [
        `${area}에 ${price ? price + "짜리 " : ""}수상한 집이 있습니다.`,
        `오늘 신고 들어온 곳, ${area} ${info.name}입니다.`,
        `줄이 계속 생기는 집을 발견했습니다.`,
      ]
    : [
        `${area}에서 이 가격에 이게 된다고?`,
        `여긴 모르면 그냥 지나칩니다.`,
        `${area} 주민들이 계속 찾는 이유가 있습니다.`,
      ];
  const ctas = [
    `${area} 맛집 더 보고 싶다면 저장해두세요.`,
    `다음에 갈 곳으로 저장해두세요.`,
    isOraki ? `다음 사건이 궁금하면 저장해두세요.` : `관악구 맛집 계속 소개해드릴게요.`,
  ];
  const hook = hooks[seed % hooks.length];
  const cta = ctas[(seed >> 3) % ctas.length];

  // 장면 시간 배분: 역할 수에 맞춰 duration 균등+가중
  const roles = isOraki
    ? ["사건 발생", "현장 출동", "첫 번째 단서", "가격 조사", "결정적 증거", "직접 검증", "탐정 판정", "사건 해결", "다음 사건 예고"]
    : ["HOOK", "장소 소개", "대표 메뉴", "맛 특징", "가성비", "추천 대상", "위치 팁", "CTA"];
  const weights = isOraki ? [2, 3, 3, 3, 4, 4, 3, 3, 2] : [2, 3, 4, 4, 3, 3, 3, 3];
  const totalW = weights.reduce((a, b) => a + b, 0);

  const narrs = isOraki
    ? [
        hook,
        "직접 확인하러 왔습니다.",
        `첫 번째 단서는 ${menu}입니다.`,
        price ? `가격은 ${price}. 단서가 되겠네요.` : "가격은 매장에서 확인이 필요합니다.",
        "김이 올라오는 이 장면이 결정적 증거입니다.",
        "한입 먹어보겠습니다. ...이건 사건이 맞네요.",
        pickVerdictPhrase(contentType, seed),
        `${area} ${info.name}. ${menu}${price ? " " + price : ""}.`,
        cta,
      ]
    : [
        hook,
        `${area}에 있는 ${info.name}입니다.`,
        `대표 메뉴는 ${menu}입니다.`,
        "양이 꽤 푸짐하게 나옵니다.",
        price ? `가격은 ${price}. 가격 생각하면 잘 나옵니다.` : "가격은 방문 전에 확인해보세요.",
        info.recommended_for ? `${info.recommended_for}에게 괜찮습니다.` : "근처 계시면 한 번 가볼 만합니다.",
        info.address ? `위치는 ${info.address} 근처입니다.` : `${area}역 근처에서 찾아가기 쉽습니다.`,
        cta,
      ];

  const subtitles = narrs.map(toSubtitle);
  const motions: Scene["camera_motion"][] = ["slow_zoom_in", "pan_right", "slow_zoom_in", "static", "push_up", "slow_zoom_in", "static", "slow_zoom_out", "static"];

  let t = 0;
  const scenes: Scene[] = roles.map((role, i) => {
    const len = Math.max(1.6, Math.round((duration * weights[i] / totalW) * 10) / 10);
    const start = Math.round(t * 10) / 10;
    let end = Math.round((t + len) * 10) / 10;
    if (i === roles.length - 1) end = duration;
    t = end;
    const roleMap = isOraki ? SCENE_ROLE_MAP[Math.min(i, SCENE_ROLE_MAP.length - 1)] : null;
    // §16: 음식 60% / 캐릭터 40% — 음식 핵심 장면은 캐릭터 없음
    const presence = roleMap?.presence ?? "none";
    const sceneDesc = isOraki
      ? `${role} — ${info.name} (${menu})`
      : `${role} — realistic Korean restaurant food scene of ${menu} at ${info.name}`;
    return {
      scene: i + 1,
      start,
      end,
      narration: narrs[i],
      subtitle: subtitles[i],
      visual_prompt: isOraki
        ? orakiImagePrompt({ sceneDescription: sceneDesc, action: roleMap?.action ?? null, expression: roleMap?.expression ?? null, presence, area })
        : foodOnlyPrompt(sceneDesc, area),
      camera_motion: motions[i % motions.length],
      character_action: isOraki ? roleMap?.action ?? null : null,
      character_expression: isOraki ? roleMap?.expression ?? null : null,
      character_presence: isOraki ? presence : "none",
      fact_source: factSourceFor(role, info),
    };
  });

  const script: ReelScript = {
    title: isOraki && ctx.caseNumber
      ? `${caseLabel(ctx.caseNumber)} ${area} ${menu} 조사`
      : `${area} ${info.name} — ${contentType}`,
    restaurant: info.name,
    target: "관악구 40~70대 (전 연령 시청 가능)",
    hook,
    duration,
    content_mode: contentMode,
    content_type: contentType as ReelScript["content_type"],
    case_number: isOraki ? ctx.caseNumber ?? null : null,
    case_title: isOraki && ctx.caseNumber ? `${area} ${menu}의 정체` : null,
    scenes,
    caption: buildSampleCaption(info, contentType),
    hashtags: buildHashtags(info),
    cta,
    verdict: isOraki
      ? {
          label: "오락이 탐정 판정",
          가성비: 3 + (seed % 3), 맛: 4, 양: 3 + ((seed >> 2) % 3), 재방문: 4,
          한줄판정: pickVerdictPhrase(contentType, seed),
        }
      : null,
    fact_check: [],
    quality_score: 0,
  };
  return script;
}

function toSubtitle(narr: string): string {
  // 한 줄 8~15자, 최대 2줄
  // 값이 비어 있어도 제작을 멈추지 않는다 — 자막 한 줄 때문에 릴스 전체를 버릴 이유가 없다
  const clean = String(narr ?? "").replace(/\s+/g, " ").trim();
  if (clean.length <= 15) return clean;
  const words = clean.split(" ");
  let line1 = "";
  let i = 0;
  while (i < words.length && (line1 + " " + words[i]).trim().length <= 14) {
    line1 = (line1 + " " + words[i]).trim(); i++;
  }
  const line2 = words.slice(i).join(" ");
  return line2 ? `${line1}\n${line2.slice(0, 15)}` : line1;
}

function foodOnlyPrompt(desc: string, area: string): string {
  return `Realistic smartphone food photography inside a Korean restaurant in ${area}, Seoul. ${desc}. ` +
    "Natural lighting, visible steam, sharp appetizing food texture, no advertising look, " +
    "vertical 9:16 composition, no text in image.";
}

function factSourceFor(role: string, info: RestaurantInfo): string {
  // 조사 결과에 확인 여부가 아예 없을 수도 있다 — 그럴 땐 "미확인" 으로 본다.
  // 확인되지 않은 값을 사실처럼 넣지 않는 것이 원칙이므로, 모르면 미확인이 맞다.
  const status = info?.field_status ?? {};
  const source = info?.source_url || "입력 정보";
  if (/가격|가성비/.test(role)) return status["menus"] === "확인" ? source : "미확인";
  if (/위치|해결|장소/.test(role)) return status["address"] === "확인" ? source : "미확인";
  return source;
}

export function buildSampleCaption(info: RestaurantInfo, contentType: string): string {
  const type = String(contentType ?? "").trim() || "동네";
  const area = String(info?.area ?? "").trim() || "신림";
  const menu = info.menus?.[0]?.name || "대표 메뉴";
  const price = info.menus?.[0]?.verified && info.menus[0]?.price ? `가격은 ${info.menus[0].price} 정도입니다.` : "";
  return [
    `${area}에서 한 끼 든든하게 먹기 좋은 곳입니다.`,
    ``,
    `대표 메뉴는 ${menu}입니다. ${price}`.trim(),
    `양도 괜찮고, 근처에서 ${type.replace(" 맛집", "")} 식사할 곳 찾는 분이라면 한 번 참고해보셔도 좋겠습니다.`,
    ``,
    `📍${info.name}`,
    info.address ? `📍${info.address}` : `📍서울 ${area}`,
    ``,
    `다음에 갈 곳으로 저장해두세요 :)`,
  ].join("\n");
}

export function buildHashtags(info: RestaurantInfo): string[] {
  const area = (String(info?.area ?? "").trim() || "신림").replace(/\s/g, "");
  const tags = new Set<string>([
    `#${area}맛집`, "#관악구맛집", "#서울맛집", "#오락푸드",
  ]);
  if (area.includes("신림")) tags.add("#신림동맛집");
  if (info.menus?.[0]?.name) tags.add(`#${info.menus[0].name.replace(/\s/g, "")}`);
  tags.add("#만두탐정오락이");
  return [...tags].slice(0, 12);
}

function sampleResearch(ctx: { name?: string; area?: string }) {
  return {
    name: ctx?.name || "신림골목식당",
    area: ctx?.area || "신림",
    note: "Sample Mode — 실제 조사 대신 입력값을 그대로 사용했습니다. 미확인 정보는 반드시 확인 후 발행하세요.",
  };
}

function sampleBenchmark() {
  return {
    hook_structure: "첫 1~2초에 가격/의외성 제시 → 시청 이유 형성",
    estimated_length: "22~28초",
    scene_structure: "훅 → 장소 → 메뉴 → 클로즈업 → 가격 → 추천 → CTA (7~9장면)",
    subtitle_style: "하단 1/3, 큰 고딕, 핵심 단어 색 강조",
    info_layout: "장면당 정보 1개, 숫자는 자막으로 반복",
    cta_structure: "저장 유도형 한 문장",
    tempo: "장면당 2~3.5초, 훅 구간은 더 빠르게",
    note: "구조만 참고합니다. 원본 문장·연출은 복제하지 않습니다.",
  };
}
