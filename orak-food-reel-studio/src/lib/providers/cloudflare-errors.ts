/**
 * Cloudflare 실패를 "무엇을 고쳐야 하는지"가 보이는 문장으로.
 * (api-failure.ts 와 같은 원칙 — `응답 401` 만 보여주면 멀쩡한 토큰을 계속 다시 만들게 된다)
 */
import { ApiError } from "./http";

export function friendlyCloudflareError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const status = e instanceof ApiError ? e.status : Number(msg.match(/^\s*(\d{3})\b/)?.[1] ?? 0);

  if (status === 401) {
    return "401: API Token 을 확인해 주세요. dash.cloudflare.com → 내 프로필 → API Tokens 에서 만든 값이 맞는지, 중간에 잘리지 않았는지 보세요.";
  }
  if (status === 403) {
    return "403: 토큰은 인식되지만 Workers AI 권한이 없습니다. 토큰을 만들 때 [Workers AI - 읽기·편집] 권한을 켜고 다시 만들어 주세요. Account ID 가 다른 계정 것일 수도 있습니다.";
  }
  if (status === 404) {
    return "404: Account ID 또는 모델 이름을 찾을 수 없습니다. Account ID 는 dash.cloudflare.com 첫 화면 오른쪽의 32자리 값입니다. 모델 이름은 [연결 테스트]가 보여주는 목록에서 고르세요.";
  }
  if (status === 429) {
    return "429: 오늘의 무료 사용량을 초과했습니다. 내일 다시 채워집니다 — 대체 공급자가 켜져 있으면 자동으로 넘어갑니다.";
  }
  if (status >= 500) {
    return `${status}: Cloudflare 서버에 문제가 있습니다. 잠시 후 다시 시도해 주세요.`;
  }
  if (/응답이 .*오지 않았습니다/.test(msg)) return msg;
  return msg.slice(0, 200);
}
