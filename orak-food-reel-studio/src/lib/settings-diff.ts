import type { AppSettings } from "./settings";

/**
 * 무엇이 바뀌었는지 사람이 읽는 문장으로.
 * "저장했습니다" 만 띄우면 정말 반영됐는지 확인할 방법이 없다.
 */

const LABEL: Partial<Record<keyof AppSettings, string>> = {
  imageProvider: "이미지 생성 공급자",
  imageModel: "이미지 생성 모델",
  publishTime: "발행 시각",
  reelDurationSec: "기본 릴스 길이",
  approvalMode: "승인 모드",
  orakiPerWeek: "주간 오락이 편수",
  appMode: "실행 모드",
  publicMediaBaseUrl: "영상 공개 주소",
};

const PROVIDER_KO: Record<string, string> = {
  gemini: "Gemini / Imagen",
  openai: "OpenAI 이미지",
  cloudflare: "Cloudflare FLUX (무료 사용량)",
  sample: "Sample (API 불필요)",
};

const MODE_KO: Record<string, string> = {
  auto: ".env 설정 따름",
  sample: "연습 모드",
  live: "실제 모드",
};

function show(key: keyof AppSettings, value: unknown): string {
  if (value === "" || value === null || value === undefined) return "(비움)";
  if (key === "imageProvider") return PROVIDER_KO[String(value)] ?? String(value);
  if (key === "appMode") return MODE_KO[String(value)] ?? String(value);
  return String(value);
}

/** 키 이름은 API 키 자체를 담지 않는다 — 저장 여부만 문장으로 알린다 */
const SECRET_LABEL: Record<string, string> = {
  ANTHROPIC_API_KEY: "Claude API 키",
  ELEVENLABS_API_KEY: "ElevenLabs API 키",
  CLOUDFLARE_API_TOKEN: "Cloudflare API Token",
  IMAGE_API_KEY: "이미지 API 키",
};

export function describeSettingsChange(
  before: AppSettings,
  after: AppSettings,
  patch: Record<string, unknown>,
): string[] {
  const out: string[] = [];

  for (const raw of Object.keys(patch)) {
    // API 키는 값이 아니라 "저장/삭제됨" 만 말한다
    if (raw in SECRET_LABEL) {
      const v = patch[raw];
      out.push(typeof v === "string" && v.trim()
        ? `${SECRET_LABEL[raw]}가 저장되었습니다.`
        : `${SECRET_LABEL[raw]}를 지웠습니다. (.env 값이 있으면 그 값을 씁니다)`);
      continue;
    }
    // 빈 값으로 저장하면 지우기다 — "저장되었습니다" 라고 하면 반대로 알아듣는다
    if (raw === "igAccessToken") {
      const v = patch[raw];
      out.push(typeof v === "string" && v.trim()
        ? "Instagram Access Token 이 암호화되어 저장되었습니다."
        : "Instagram Access Token 을 지웠습니다.");
      continue;
    }
    if (raw === "igUserId") {
      const v = patch[raw];
      out.push(typeof v === "string" && v.trim()
        ? "Instagram User ID 가 저장되었습니다."
        : "Instagram User ID 를 지웠습니다.");
      continue;
    }

    const key = raw as keyof AppSettings;
    const b = before[key];
    const a = after[key];
    if (JSON.stringify(b) === JSON.stringify(a)) continue;

    const label = LABEL[key];
    if (label) {
      out.push(`${label}이(가) ${show(key, b)} 에서 ${show(key, a)} 로 변경되었습니다.`);
      continue;
    }
    if (key === "tts") {
      const bv = b as AppSettings["tts"];
      const av = a as AppSettings["tts"];
      if (bv.voiceId !== av.voiceId) out.push(`목소리가 ${bv.voiceId || "(없음)"} 에서 ${av.voiceId || "(없음)"} 로 변경되었습니다.`);
      if (bv.model !== av.model) out.push(`음성 모델이 ${bv.model} 에서 ${av.model} 로 변경되었습니다.`);
      if (bv.speed !== av.speed) out.push(`말하기 속도가 ${bv.speed} 에서 ${av.speed} 로 변경되었습니다.`);
      if (bv.stability !== av.stability || bv.similarity !== av.similarity) out.push("음성 세부 설정이 변경되었습니다.");
      continue;
    }
    if (key === "publishDays") {
      const av = a as AppSettings["publishDays"];
      const on = Object.entries(av).filter(([, v]) => v).map(([k]) => k);
      out.push(`발행 요일이 ${on.length}일로 변경되었습니다.`);
      continue;
    }
    if (key === "characterLock") {
      const bv = b as AppSettings["characterLock"];
      const av = a as AppSettings["characterLock"];
      if (bv.enabled !== av.enabled) out.push(`캐릭터 고정이 ${av.enabled ? "켜졌습니다" : "꺼졌습니다"}.`);
      if (bv.seed !== av.seed) out.push(`Character Seed 가 ${bv.seed} 에서 ${av.seed} 로 변경되었습니다.`);
      if (bv.referenceImages.length !== av.referenceImages.length) {
        out.push(`기준 이미지가 ${bv.referenceImages.length}개에서 ${av.referenceImages.length}개로 변경되었습니다.`);
      }
      continue;
    }
    out.push(`${String(key)} 설정이 변경되었습니다.`);
  }

  if (out.length === 0) out.push("변경된 내용이 없습니다. (값이 이미 같습니다)");
  return out;
}
