/**
 * 화면·로그·DB에 남는 글에서 비밀값을 지운다.
 *
 * 왜 필요한가: 외부 API가 돌려준 오류 문구를 그대로 보여주다가
 * API 키가 화면에 찍힌 일이 있었다. 오류 문구는 우리가 만든 게 아니므로
 * 무엇이 섞여 나올지 알 수 없다 — 내보내기 직전에 한 번 걸러야 한다.
 *
 * 의존성이 없다(다른 모듈을 import 하지 않는다). 로그·설정 어디서 불러도
 * 순환 참조가 생기지 않게 하기 위함이다.
 */

const MASK = "***가려짐***";

/** 실제로 쓰이는 키 값들 — resolveSecret 이 읽을 때마다 등록된다 */
const known = new Set<string>();

export function rememberSecret(value: string): void {
  if (value && value.trim().length >= 12) known.add(value.trim());
}

/** 테스트용 */
export function forgetSecrets(): void {
  known.clear();
}

const PATTERNS: RegExp[] = [
  // NAME=값 형태로 통째로 붙여넣은 경우 (.env 한 줄을 그대로 붙여넣는 실수)
  /\b[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)\s*=\s*[^\s'"&]+/g,
  /\bsk-[A-Za-z0-9_-]{16,}/g,          // OpenAI / Anthropic
  /\bAIza[A-Za-z0-9_-]{20,}/g,         // Google
  /\bEAA[A-Za-z0-9]{20,}/g,            // Meta 액세스 토큰
  /\bxi-[A-Za-z0-9_-]{16,}/g,          // ElevenLabs 계열
  /\b[a-fA-F0-9]{32,}\b/g,             // ElevenLabs API 키(16진수)
];

/** 문자열에서 비밀값을 가린다 */
export function redact(input: string): string {
  if (!input) return input;
  let out = input;
  // 알고 있는 실제 키부터 (부분 문자열이라도 지워야 하므로 패턴보다 먼저)
  for (const secret of known) {
    if (secret && out.includes(secret)) out = out.split(secret).join(MASK);
  }
  for (const re of PATTERNS) out = out.replace(re, MASK);
  return out;
}

/** Error / 임의 값 → 가려진 문자열 */
export function redactError(e: unknown): string {
  return redact(e instanceof Error ? e.message : String(e));
}
