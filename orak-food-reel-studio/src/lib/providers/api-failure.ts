/**
 * 실패 응답을 "무엇을 고쳐야 하는지"가 보이는 문장으로.
 *
 * `응답 401` 만 보여 주면 사용자는 멀쩡한 키를 계속 다시 발급받게 된다.
 * 서비스가 돌려준 사유(권한 부족인지, 폐기된 키인지, 잔액 문제인지)를 함께 읽어
 * 다음에 할 일을 알려준다.
 */

export type KeyService = "anthropic" | "elevenlabs" | "gemini" | "openai";

const WHERE: Record<KeyService, string> = {
  anthropic: "console.anthropic.com → API Keys 에서 받은 sk-ant-… 값",
  elevenlabs: "elevenlabs.io → 프로필 → API Keys 에서 받은 값",
  gemini: "aistudio.google.com/apikey 에서 [API 키 만들기]로 받은 AIza… 값",
  openai: "platform.openai.com → API keys 에서 받은 sk-… 값",
};

/** 응답 본문에서 사람이 읽을 사유만 뽑는다 */
export function extractReason(raw: string): string {
  if (!raw) return "";
  try {
    const j = JSON.parse(raw) as {
      error?: { message?: string };
      detail?: { message?: string; status?: string } | string;
      message?: string;
    };
    if (typeof j.detail === "string") return j.detail;
    if (j.detail?.message) return j.detail.status ? `${j.detail.message} (${j.detail.status})` : j.detail.message;
    return j.error?.message ?? j.message ?? raw.slice(0, 160);
  } catch {
    return raw.slice(0, 160);
  }
}

export function describeKeyFailure(service: KeyService, status: number, raw: string): string {
  const reason = extractReason(raw);
  const tail = reason ? ` — ${reason.slice(0, 160)}` : "";

  // 키 자체는 맞는데 권한이 없는 경우 — 키를 다시 만들라고 하면 안 된다
  if (/missing_permission|insufficient_permission|not authorized|scope/i.test(reason)) {
    return service === "elevenlabs"
      ? `키는 인식되지만 권한이 부족합니다. ElevenLabs 에서 키를 만들 때 Voices(읽기)와 Text to Speech 권한을 켜 주세요.${tail}`
      : `키는 인식되지만 이 작업에 대한 권한이 없습니다. 키 권한 설정을 확인하세요.${tail}`;
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
