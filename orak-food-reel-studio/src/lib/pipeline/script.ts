import { ReelScriptSchema, type ReelScript, type RestaurantInfo, CONTENT_TYPES } from "../schema";
import { getLLM, extractJson } from "../providers/llm";
import { PD_SYSTEM_PROMPT, ORAKI_SYSTEM_PROMPT, scriptUserPrompt } from "../content/prompts";
import { checkDuplicate } from "./quality";
import { db, j, nextCaseNumber } from "../db";
import { pickContentType } from "../content/strategy";
import { logInfo, logWarn } from "../log";
import { normalizeScriptDraft } from "../content/normalize";
import type { ContentMode } from "../schema";

export interface ScriptOptions {
  contentType?: string;      // "자동 추천"이면 순환 선택
  contentMode: ContentMode;
  duration: number;
}

/** 대본 생성 + Zod 검증 + 중복 검사(§28: 너무 비슷하면 자동 재생성) */
export async function generateScript(info: RestaurantInfo, opts: ScriptOptions): Promise<ReelScript> {
  const contentType = !opts.contentType || opts.contentType === "자동 추천"
    ? pickContentType()
    : (CONTENT_TYPES as readonly string[]).includes(opts.contentType) ? opts.contentType : pickContentType();

  const caseNumber = opts.contentMode === "ORAKI_DETECTIVE" ? nextCaseNumber() : undefined;
  const recent = recentHooksCtas();

  let lastError = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const llm = getLLM();
    const raw = await llm.complete({
      task: "script",
      system: opts.contentMode === "ORAKI_DETECTIVE" ? ORAKI_SYSTEM_PROMPT : PD_SYSTEM_PROMPT,
      user: scriptUserPrompt(info, {
        contentType,
        contentMode: opts.contentMode,
        duration: opts.duration,
        caseNumber,
        avoidHooks: recent.hooks,
        avoidCtas: recent.ctas,
      }) + (lastError
        ? `\n\n[재시도] 직전 응답이 검증에서 거부됐다. 오류: ${lastError}\n` +
          `위에 제시한 허용 값 목록을 벗어난 값은 절대 만들지 마라. ` +
          `camera_motion / character_action / character_expression / character_presence 는 목록에 적힌 문자열을 그대로 복사해서 쓸 것.`
        : ""),
      context: { info, contentType, contentMode: opts.contentMode, duration: opts.duration, caseNumber },
      maxTokens: 6000,
    });

    let script: ReelScript;
    try {
      // AI가 enum을 살짝 벗어난 값을 만들어도 대본 전체를 버리지 않도록
      // 검증 전에 고칠 수 있는 값은 내부 값으로 맞춘다 (못 맞추면 안전한 기본값)
      const draft = normalizeScriptDraft(JSON.parse(extractJson(raw)), {
        contentType, contentMode: opts.contentMode, duration: opts.duration,
        caseNumber, restaurantName: info.name,
      });
      script = ReelScriptSchema.parse(draft);
    } catch (e) {
      lastError = e instanceof Error ? e.message.slice(0, 400) : String(e);
      logWarn("script", `검증 실패(시도 ${attempt + 1}): ${lastError}`);
      continue;
    }

    const dup = checkDuplicate(script);
    if (dup.tooSimilar && attempt < 2 && llm.name !== "sample") {
      lastError = `최근 콘텐츠(${dup.against})와 유사도 ${dup.score}. 훅/구성/CTA를 다르게 다시 써라.`;
      logWarn("script", lastError);
      continue;
    }
    logInfo("script", `대본 생성 완료 — ${script.title} (${script.scenes.length}장면, 중복 ${dup.score})`);
    return script;
  }
  throw new Error(`대본 생성 실패: ${lastError}`);
}

function recentHooksCtas(): { hooks: string[]; ctas: string[] } {
  const rows = db().prepare("SELECT script_json FROM reels ORDER BY created_at DESC LIMIT 6")
    .all() as Array<{ script_json: string }>;
  const hooks: string[] = [];
  const ctas: string[] = [];
  for (const r of rows) {
    const s = j<{ hook?: string; cta?: string }>(r.script_json, {});
    if (s.hook) hooks.push(s.hook);
    if (s.cta) ctas.push(s.cta);
  }
  return { hooks: hooks.slice(0, 5), ctas: ctas.slice(0, 5) };
}
