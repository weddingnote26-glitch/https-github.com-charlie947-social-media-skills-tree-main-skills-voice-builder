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
