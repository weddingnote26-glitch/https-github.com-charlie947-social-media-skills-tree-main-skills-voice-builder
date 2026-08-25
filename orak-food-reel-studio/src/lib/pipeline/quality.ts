import type { ReelScript } from "../schema";
import { similarityAgainstRecent } from "../content/strategy";

/** §27 품질점수 — 100점 만점, 80점 미만이면 수정안 생성 대상 */
export interface QualityResult {
  total: number;
  parts: Record<string, { score: number; max: number; note: string }>;
  suggestions: string[];
  pass: boolean;
}

const BANNED = ["환상적인", "미식 경험", "최고급 재료", "잊을 수 없는 풍미", "선사하는", "황홀"];

export function scoreQuality(script: ReelScript, factBlocked: boolean, factOk: number, factTotal: number): QualityResult {
  const parts: QualityResult["parts"] = {};
  const suggestions: string[] = [];

  // HOOK 20 — 길이·구체성·물음/의외성
  let hook = 12;
  if (script.hook.length >= 8 && script.hook.length <= 40) hook += 4;
  if (/[?!]|는다고|이유|정체|수상/.test(script.hook)) hook += 4;
  if (script.hook.length > 50) { hook -= 4; suggestions.push("HOOK이 깁니다. 한 문장으로 줄이세요."); }
  parts["HOOK"] = { score: clamp(hook, 0, 20), max: 20, note: script.hook };

  // 정보성 20 — 메뉴/가격/위치/추천대상 언급 수
  const all = script.scenes.map((s) => s.narration).join(" ");
  let info = 0;
  if (/메뉴|만두|국밥|찌개|정식|[가-힣]+집/.test(all)) info += 5;
  if (/원|가격/.test(all)) info += 5;
  if (/역|골목|근처|위치|주소/.test(all)) info += 5;
  if (/추천|괜찮|가볼 만|분이라면/.test(all)) info += 5;
  if (info < 15) suggestions.push("메뉴·가격·위치·추천 대상 중 빠진 정보를 채우세요.");
  parts["정보성"] = { score: info, max: 20, note: `${info / 5}개 정보 축 포함` };

  // 영상 템포 15 — 장면 길이 1.5~3.5초(훅은 더 짧게 허용, §21)
  let tempo = 15;
  for (const s of script.scenes) {
    const len = s.end - s.start;
    if (len > 4.5) { tempo -= 3; suggestions.push(`SCENE ${s.scene}이 ${len.toFixed(1)}초로 깁니다.`); }
    else if (len > 3.5) tempo -= 1;
  }
  parts["영상 템포"] = { score: clamp(tempo, 0, 15), max: 15, note: `${script.scenes.length}개 장면` };

  // 대본 자연스러움 15 — 금지 표현·문장 길이
  let natural = 15;
  for (const b of BANNED) {
    if (all.includes(b)) { natural -= 5; suggestions.push(`AI 티가 나는 표현 "${b}"를 바꾸세요.`); }
  }
  const longSent = script.scenes.filter((s) => s.narration.length > 45).length;
  natural -= longSent * 2;
  if (longSent) suggestions.push(`너무 긴 나레이션이 ${longSent}개 있습니다.`);
  parts["대본 자연스러움"] = { score: clamp(natural, 0, 15), max: 15, note: "" };

  // 자막 가독성 10 — 줄당 15자 이하, 2줄 이하
  let subs = 10;
  for (const s of script.scenes) {
    const lines = s.subtitle.split("\n");
    if (lines.length > 2 || lines.some((l) => l.length > 16)) {
      subs -= 2; suggestions.push(`SCENE ${s.scene} 자막이 깁니다(한 줄 8~15자, 최대 2줄).`);
    }
  }
  parts["자막 가독성"] = { score: clamp(subs, 0, 10), max: 10, note: "" };

  // 타깃 적합성 10 — 쉬운 표현, 외래어 남용 없음
  let target = 10;
  if (/(핫플|인싸|JMT|플렉스)/i.test(all)) { target -= 4; suggestions.push("주 타깃(40~70대)에게 낯선 유행어가 있습니다."); }
  parts["타깃 적합성"] = { score: clamp(target, 0, 10), max: 10, note: "" };

  // CTA 5
  let cta = script.cta ? 5 : 0;
  if (!script.cta) suggestions.push("CTA가 없습니다.");
  parts["CTA"] = { score: cta, max: 5, note: script.cta };

  // 팩트 신뢰도 5
  const fact = factBlocked ? 0 : Math.round((factOk / Math.max(1, factTotal)) * 5);
  if (factBlocked) suggestions.push("팩트체크 차단 사유를 해결해야 합니다.");
  parts["팩트 신뢰도"] = { score: fact, max: 5, note: `${factOk}/${factTotal} 확인됨` };

  const total = Object.values(parts).reduce((a, p) => a + p.score, 0);
  return { total, parts, suggestions, pass: total >= 80 };
}

/** §28 중복 검사 — 0.55 이상이면 재생성 권고 */
export function checkDuplicate(script: ReelScript, excludeReelId?: string): { tooSimilar: boolean; score: number; against?: string } {
  const { maxScore, against } = similarityAgainstRecent({
    title: script.title,
    hook: script.hook,
    cta: script.cta,
    narrations: script.scenes.map((s) => s.narration),
  }, 10, excludeReelId);
  return { tooSimilar: maxScore >= 0.55, score: Math.round(maxScore * 100) / 100, against };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
