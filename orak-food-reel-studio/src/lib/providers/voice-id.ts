/**
 * ElevenLabs 목소리 ID 검사.
 *
 * 실제로 있었던 일: .env 한 줄(`ELEVENLABS_API_KEY=…`)을 목소리 ID 칸에
 * 통째로 붙여넣어, API 키가 주소에 실려 나가고 오류 문구에 그대로 찍혔다.
 * 값이 밖으로 나가기 전에 여기서 막는다.
 */

export interface VoiceIdCheck {
  ok: boolean;
  reason?: string;
}

export function checkVoiceId(raw: string | undefined | null): VoiceIdCheck {
  const v = (raw ?? "").trim();
  if (!v) return { ok: false, reason: "목소리를 아직 고르지 않았습니다. 설정 → 목소리 고르기에서 선택해 주세요." };

  if (/[=\s]/.test(v) || /(KEY|TOKEN|SECRET)/i.test(v)) {
    return {
      ok: false,
      reason: "목소리 ID 칸에 API 키가 들어가 있습니다. 이 칸에는 목소리 ID만 넣어야 합니다 — 설정 → 목소리 고르기에서 목록으로 선택해 주세요.",
    };
  }
  if (/^sk[-_]/i.test(v) || /^AIza/.test(v) || /^[a-fA-F0-9]{32,}$/.test(v)) {
    return {
      ok: false,
      reason: "목소리 ID가 아니라 API 키로 보입니다. 설정 → 목소리 고르기에서 목록으로 선택해 주세요.",
    };
  }
  if (!/^[A-Za-z0-9]{15,30}$/.test(v)) {
    return {
      ok: false,
      reason: "목소리 ID 형식이 아닙니다 (영문·숫자 20자 내외). 설정 → 목소리 고르기에서 목록으로 선택해 주세요.",
    };
  }
  return { ok: true };
}

/** 목소리 ID 형태인가 (영문·숫자 20자 내외, 밑줄 없음) */
export function looksLikeVoiceId(raw: string | undefined | null): boolean {
  return /^[A-Za-z0-9]{15,30}$/.test((raw ?? "").trim());
}

/**
 * TTS Model 칸 검사.
 * ElevenLabs 모델은 eleven_multilingual_v2 처럼 밑줄이 들어간 이름이다.
 * 여기에 목소리 ID가 들어가 있으면 두 칸을 바꿔 넣은 것이다.
 */
export function checkTtsModel(raw: string | undefined | null): VoiceIdCheck {
  const v = (raw ?? "").trim();
  if (!v) return { ok: true }; // 비우면 기본값을 쓴다
  if (looksLikeVoiceId(v)) {
    return {
      ok: false,
      reason: `Model 칸에 목소리 ID(${v})가 들어가 있습니다. Model 은 eleven_multilingual_v2 같은 이름이어야 합니다 — 두 칸의 값이 서로 바뀐 것 같습니다.`,
    };
  }
  if (/(KEY|TOKEN|SECRET)/i.test(v) || /[=\s]/.test(v)) {
    return { ok: false, reason: "Model 칸에 API 키가 들어가 있습니다. eleven_multilingual_v2 로 되돌려 주세요." };
  }
  return { ok: true };
}

/**
 * 목소리 ID 칸과 Model 칸이 서로 바뀐 경우를 알아본다.
 * 바로잡을 값까지 함께 돌려줘, 사용자가 어느 칸에 무엇을 넣을지 헤매지 않게 한다.
 */
export function detectSwappedVoiceFields(
  voiceId: string | undefined | null,
  model: string | undefined | null,
): { swapped: boolean; voiceId?: string; reason?: string } {
  const v = (voiceId ?? "").trim();
  const m = (model ?? "").trim();
  if (!looksLikeVoiceId(m)) return { swapped: false };
  if (checkVoiceId(v).ok) return { swapped: false }; // 목소리 ID 칸이 이미 멀쩡하면 건드리지 않는다
  return {
    swapped: true,
    voiceId: m,
    reason: `목소리 ID 칸과 Model 칸의 값이 서로 바뀌었습니다. 목소리 ID는 ${m} 이고, Model 은 eleven_multilingual_v2 입니다.`,
  };
}
