/**
 * 실패 응답을 "무엇을 고쳐야 하는지"가 보이는 문장으로.
 *
 * `응답 401` 만 보여 주면 사용자는 멀쩡한 키를 계속 다시 발급받게 된다.
 * 서비스가 돌려준 사유(권한 부족인지, 폐기된 키인지, 잔액 문제인지)를 함께 읽어
 * 다음에 할 일을 알려준다.
 */

export type KeyService = "anthropic" | "elevenlabs" | "gemini" | "openai" | "instagram";

const WHERE: Record<KeyService, string> = {
  anthropic: "console.anthropic.com → API Keys 에서 받은 sk-ant-… 값",
  elevenlabs: "elevenlabs.io → 프로필 → API Keys 에서 받은 값",
  gemini: "aistudio.google.com/apikey 에서 [API 키 만들기]로 받은 AIza… 값",
  openai: "platform.openai.com → API keys 에서 받은 sk-… 값",
  instagram: "developers.facebook.com → 도구 → 그래프 API 탐색기 에서 만든 액세스 토큰",
};

/** 그래프 API 탐색기 위치 — 안내 문구에서 반복해 쓴다 */
const META_TOOL = "developers.facebook.com → 도구 → 그래프 API 탐색기";

/**
 * 오류 본문 앞에 붙은 상태 코드를 걷어낸다.
 * fetchJson 은 `400 {"error":…}` 모양으로 예외 메시지를 만들기 때문에
 * 그대로 JSON.parse 하면 항상 실패해서 영어 원문이 화면에 그대로 남는다.
 */
function bodyOf(raw: string): string {
  return raw.replace(/^\s*\d{3}\s+/, "").trim();
}

/** 응답 본문에서 사람이 읽을 사유만 뽑는다 */
export function extractReason(raw: string): string {
  if (!raw) return "";
  const text = bodyOf(raw);
  try {
    const j = JSON.parse(text) as {
      error?: { message?: string };
      detail?: { message?: string; status?: string } | string;
      message?: string;
    };
    if (typeof j.detail === "string") return j.detail;
    if (j.detail?.message) return j.detail.status ? `${j.detail.message} (${j.detail.status})` : j.detail.message;
    return j.error?.message ?? j.message ?? text.slice(0, 160);
  } catch {
    return text.slice(0, 160);
  }
}

/* ---------- Meta(Instagram) ---------- */

interface MetaError { message: string; code: number; subcode: number; type: string }

/** Meta 는 error.code / error_subcode 로 원인을 구분한다 — 문구만 봐서는 알 수 없다 */
export function metaError(raw: string): MetaError {
  try {
    const j = JSON.parse(bodyOf(raw)) as {
      error?: { message?: string; code?: number; error_subcode?: number; type?: string };
    };
    const e = j.error ?? {};
    return {
      message: e.message ?? "",
      code: Number(e.code ?? 0),
      subcode: Number(e.error_subcode ?? 0),
      type: e.type ?? "",
    };
  } catch {
    return { message: bodyOf(raw).slice(0, 160), code: 0, subcode: 0, type: "" };
  }
}

/**
 * Instagram(Meta Graph) 실패 안내.
 *
 * `응답 400 — 토큰/권한을 확인하세요` 는 세 가지 다른 문제를 한 문장으로 뭉뚱그린다:
 * 토큰 만료, 권한 누락, 그리고 잘못된 계정 ID. 고쳐야 할 곳이 서로 달라서
 * 구분하지 않으면 맞는 값을 넣어 두고도 계속 헤매게 된다.
 */
function describeMetaFailure(status: number, raw: string): string {
  const { message, code, subcode } = metaError(raw);
  const tail = message ? ` — ${message.slice(0, 200)}` : "";

  // 요청 한도 (code 4·17·32·613)
  if (status === 429 || [4, 17, 32, 613].includes(code)) {
    return `Meta 요청 한도를 넘었습니다. 잠시 뒤에 다시 눌러 주세요.${tail}`;
  }
  if (status >= 500) {
    return `Meta 서버에 문제가 있습니다 (${status}). 잠시 뒤에 다시 시도해 주세요.${tail}`;
  }

  // 토큰 만료 — 그래프 API 탐색기 기본 토큰은 몇 시간이면 끝난다
  if (subcode === 463 || /expired|has expired/i.test(message)) {
    return "액세스 토큰이 만료되었습니다. 그래프 API 탐색기에서 그냥 만든 토큰은 몇 시간이면 끝납니다. " +
      `${META_TOOL} 에서 토큰을 새로 만든 뒤, [도구 → 액세스 토큰 디버거]에서 [연장하기(Extend)]를 눌러 ` +
      "60일짜리 장기 토큰으로 바꿔 넣어 주세요.";
  }
  // 비밀번호 변경·로그아웃으로 무효화
  if (subcode === 460 || subcode === 467) {
    return "액세스 토큰이 무효화되었습니다(비밀번호 변경 또는 로그아웃). " +
      `${META_TOOL} 에서 토큰을 새로 만들어 넣어 주세요.${tail}`;
  }
  // 토큰 자체가 안 읽힘
  if (code === 190 || code === 102 || /access token/i.test(message)) {
    return "액세스 토큰이 올바르지 않습니다. 토큰이 중간에 잘리지 않고 전체가 복사됐는지 확인하고, " +
      `${META_TOOL} 에서 다시 만들어 주세요.${tail}`;
  }
  // ID 를 못 찾음 — 페이스북 페이지 ID 를 넣는 실수가 가장 흔하다.
  // Meta 는 "없는 ID" 와 "권한 부족" 을 같은 문구로 돌려주므로 둘 다 짚어 준다.
  if (code === 100 && (subcode === 33 || /does not exist|cannot be loaded|Unsupported/i.test(message))) {
    return "Instagram User ID 를 확인할 수 없습니다. ① 페이스북 페이지 ID 가 아니라 " +
      "Instagram 비즈니스 계정 ID 인지, ② 토큰에 instagram_basic 권한이 있는지 확인해 주세요. " +
      `${META_TOOL} 에서 me/accounts?fields=name,instagram_business_account 를 조회하면 올바른 ID 가 보입니다.${tail}`;
  }
  // 권한 누락 — 토큰은 맞으므로 "새로 발급"만 시키면 헛수고가 된다
  if (code === 10 || code === 200 || code === 3 || /permission/i.test(message)) {
    return "토큰은 인식되지만 권한이 부족합니다. 토큰을 만들 때 " +
      "instagram_basic, instagram_content_publish, pages_show_list, pages_read_engagement 를 모두 켜고 " +
      "다시 만들어 주세요.";
  }
  if (code === 100) {
    return `요청 값이 올바르지 않습니다. Instagram User ID 를 다시 확인해 주세요.${tail}`;
  }
  return `응답 ${status}${tail || " — 토큰과 Instagram User ID 를 확인해 주세요."}`;
}

export function describeKeyFailure(service: KeyService, status: number, raw: string): string {
  if (service === "instagram") return describeMetaFailure(status, raw);

  const reason = extractReason(raw);
  const tail = reason ? ` — ${reason.slice(0, 160)}` : "";

  // 키 자체는 맞는데 권한이 없는 경우 — 키를 다시 만들라고 하면 안 된다
  if (/missing_permission|insufficient_permission|not authorized|scope/i.test(reason)) {
    return service === "elevenlabs"
      ? `키는 인식되지만 권한이 부족합니다. ElevenLabs 에서 키를 만들 때 Voices(읽기)와 Text to Speech 권한을 켜 주세요.${tail}`
      : `키는 인식되지만 이 작업에 대한 권한이 없습니다. 키 권한 설정을 확인하세요.${tail}`;
  }
  // 402 = 요금제 제한. 키도 권한도 맞는데 요금제가 막는 경우라
  // "키를 다시 발급하라"고 하면 아무리 해도 해결되지 않는다.
  if (status === 402 || /payment_required|paid_plan_required|upgrade your subscription/i.test(reason)) {
    return service === "elevenlabs"
      ? "ElevenLabs 무료 요금제에서는 Voice Library 목소리를 API로 쓸 수 없습니다. " +
        "① 목소리 고르기에서 '기본' 표시가 있는 목소리를 고르거나, " +
        "② elevenlabs.io 에서 유료 요금제(Starter 이상)로 올리세요."
      : `요금제가 이 기능을 허용하지 않습니다 (402).${tail}`;
  }
  if (status === 401) {
    return `키가 거부되었습니다 (401). 폐기됐거나 오타일 수 있습니다. ${WHERE[service]}인지 확인하고, 필요하면 새로 발급해 주세요.${tail}`;
  }
  if (status === 400 || status === 403) {
    return `키가 거부되었습니다 (${status}). ${WHERE[service]}인지 확인하세요.${tail}`;
  }
  if (status === 429) {
    return service === "elevenlabs"
      ? `사용 한도를 초과했습니다 (429). elevenlabs.io 에서 남은 크레딧을 확인하세요.${tail}`
      : `사용 한도를 초과했습니다 (429). 결제(유료 등급) 설정을 확인하거나 잠시 후 다시 시도하세요.${tail}`;
  }
  if (status >= 500) {
    return `${service} 서버에 문제가 있습니다 (${status}). 잠시 후 다시 시도해 주세요.${tail}`;
  }
  return `응답 ${status}${tail}`;
}
