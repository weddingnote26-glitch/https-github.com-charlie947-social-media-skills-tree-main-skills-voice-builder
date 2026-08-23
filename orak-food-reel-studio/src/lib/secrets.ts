import { getEnv } from "./env";
import { kvGet, kvSet, getSettings } from "./settings";
import { encrypt, decrypt } from "./crypto";
import { logWarn } from "./log";
import { rememberSecret } from "./redact";

/**
 * API 키를 화면에서 바꿀 수 있게 하는 계층.
 *
 * 예전에는 .env 를 메모장으로 열어 고치고 서버를 껐다 켜야 했다.
 * 이제 설정 화면에서 넣은 키를 암호화해 DB에 저장하고, 그 값을 먼저 쓴다.
 * (.env 는 그대로 두면 예비값으로 계속 동작한다)
 */
export type SecretName = "ANTHROPIC_API_KEY" | "ELEVENLABS_API_KEY" | "IMAGE_API_KEY";

const KEY_PREFIX = "secret_";

/** 설정 화면에 저장된 값 → 없으면 .env 값 */
export function resolveSecret(name: SecretName): string {
  const stored = kvGet(KEY_PREFIX + name);
  if (stored) {
    try {
      const v = decrypt(stored);
      rememberSecret(v);
      return v;
    } catch {
      logWarn("secrets", `${name} 복호화 실패 — .env 값을 사용합니다`);
    }
  }
  const v = getEnv()[name] ?? "";
  rememberSecret(v);
  return v;
}

/** 빈 문자열이면 저장된 키를 지운다(.env 값으로 되돌아감) */
export function setSecret(name: SecretName, value: string): void {
  const v = value.trim();
  if (!v) {
    kvSet(KEY_PREFIX + name, "");
    return;
  }
  kvSet(KEY_PREFIX + name, encrypt(v));
}

/** 화면 표시용 — 키 전체를 보내지 않고 있는지/어디서 왔는지만 */
export function secretStatus(name: SecretName): { set: boolean; source: "설정" | ".env" | "없음"; hint: string } {
  const stored = kvGet(KEY_PREFIX + name);
  const envValue = getEnv()[name] ?? "";
  const value = stored ? resolveSecret(name) : envValue;
  const source = stored ? "설정" : envValue ? ".env" : "없음";
  return {
    set: !!value,
    source,
    hint: value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "",
  };
}

/**
 * 실행 모드 — 설정 화면 값이 .env 보다 우선.
 * sample 이면 외부 API를 부르지 않고 샘플 데이터로만 동작한다.
 */
export function getAppMode(): "sample" | "live" {
  const s = getSettings().appMode;
  if (s === "sample" || s === "live") return s;
  return getEnv().APP_MODE;
}

export function isSampleMode(): boolean {
  return getAppMode() === "sample";
}
