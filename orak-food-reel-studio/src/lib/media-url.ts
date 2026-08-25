/**
 * 완성 영상의 "공개 주소" 검사.
 *
 * Instagram 은 우리가 영상 파일을 올려 주는 게 아니라, 우리가 알려 준 주소로
 * Meta 서버가 직접 내려받는다. 그래서 내 PC 안에서만 열리는 주소(localhost,
 * 192.168.…)를 넣으면 저장은 되지만 발행 단계에서 조용히 실패한다.
 * 저장하는 순간에 걸러 주는 편이 낫다.
 */

const PRIVATE_HOST =
  /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[?::1\]?|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/i;

/** 영상 파일을 내려줄 리 없는 SNS·포털 페이지 주소들 */
const SNS_HOST =
  /(^|\.)(instagram\.com|facebook\.com|fb\.com|youtube\.com|youtu\.be|tiktok\.com|twitter\.com|x\.com|threads\.net|naver\.com|blog\.me|kakao\.com|band\.us)$/i;

export interface UrlCheck { ok: boolean; reason?: string; warn?: string }

export function checkPublicMediaUrl(raw: string): UrlCheck {
  const v = raw.trim();
  if (!v) return { ok: true }; // 아직 안 정한 상태 — 발행할 때 다시 막는다

  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return { ok: false, reason: "주소 모양이 아닙니다. https:// 로 시작하는 전체 주소를 넣어 주세요. (예: https://reels.내주소.com)" };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    return { ok: false, reason: `${u.protocol} 로는 영상을 받을 수 없습니다. https:// 로 시작하는 주소를 넣어 주세요.` };
  }
  /* 실제로 겪은 일: 이 칸에 https://www.instagram.com/orak_food (프로필 주소)를
     넣었는데 모양 검사만 하던 예전 코드가 ✅ 로 통과시켰다.
     SNS 페이지 주소는 우리 영상 파일을 내려줄 수 없다 — 이름을 보고 거른다. */
  if (SNS_HOST.test(u.hostname)) {
    return {
      ok: false,
      reason: `"${u.hostname}" 은 SNS 페이지 주소입니다. 여기에는 Instagram 서버가 내려받을 ` +
        "우리 영상 파일 주소를 넣어야 합니다 — 인스타그램 계정 주소가 아닙니다. " +
        "Cloudflare Tunnel 등으로 이 프로그램을 인터넷에 연 주소(예: https://reels.내주소.com)를 넣어 주세요.",
    };
  }
  if (PRIVATE_HOST.test(u.hostname)) {
    return {
      ok: false,
      reason: `"${u.hostname}" 은 이 PC 안에서만 열리는 주소입니다. Instagram 서버가 여기로 영상을 받으러 오지 못합니다 — ` +
        "Cloudflare Tunnel 같은 걸로 만든 인터넷 주소를 넣어 주세요.",
    };
  }
  if (u.protocol === "http:") {
    return { ok: true, warn: "http:// 주소입니다. Meta 는 https:// 를 권합니다 — 발행이 막히면 https 주소로 바꿔 보세요." };
  }
  if (u.search || u.hash) {
    return { ok: true, warn: "주소 뒤에 ? 나 # 가 붙어 있습니다. 영상 파일 경로가 뒤에 이어 붙으므로 보통은 빼는 게 맞습니다." };
  }
  return { ok: true };
}
