/**
 * "지금 이 프로그램은 어느 주소로 열려 있나" 를 한 자리에서 판단한다.
 *
 * 왜 필요한가: 완성 영상을 Instagram 이 내려받으려면 이 프로그램이 인터넷에 열려 있어야 하고,
 * 그때 쓰는 Cloudflare Tunnel 명령에는 포트를 정확히 적어야 한다.
 * 사람이 포트를 외우고 있을 이유가 없으므로 화면이 직접 알려 준다.
 */

/** 내 PC 안에서만 열리는 주소 — 인터넷에서는 닿지 않는다 */
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?)$/i;

/** 못 박아 둔 기본 포트 (start.bat · 설치형 앱이 함께 쓰는 값) */
export const DEFAULT_PORT = "3000";

export interface AppAddress {
  /** 지금 보고 있는 주소 (예: http://localhost:3000) */
  current: string;
  host: string;
  /** 포트. 주소에 안 적혀 있으면 규칙상 기본값(http 80 / https 443) */
  port: string;
  /** 내 PC 주소인가 */
  isLocal: boolean;
  /** 터널을 열 때 그대로 붙여넣는 명령 한 줄 — 내 PC 주소일 때만 */
  tunnelCommand: string | null;
  /** 기본 포트가 아니라서 사람이 외우던 명령이 틀리게 될 때의 안내 */
  portNotice: string | null;
}

/**
 * 브라우저 주소(location.href)를 받아 화면에 보여 줄 값으로 바꾼다.
 * 주소를 못 읽으면 null — 화면에서는 이 칸을 통째로 감춘다(틀린 안내보다 낫다).
 */
export function describeAppAddress(href: string): AppAddress | null {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;

  const isLocal = LOCAL_HOST.test(u.hostname);
  const port = u.port || (u.protocol === "https:" ? "443" : "80");
  const current = `${u.protocol}//${u.host}`;

  return {
    current,
    host: u.host,
    port,
    isLocal,
    // 터널은 "내 PC 의 이 포트를 인터넷에 열어라" 라는 뜻이다.
    // 이미 인터넷 주소로 보고 있다면 명령을 보여 줄 이유가 없다.
    tunnelCommand: isLocal ? `cloudflared tunnel --url http://localhost:${port}` : null,
    portNotice: isLocal && port !== DEFAULT_PORT
      ? `${DEFAULT_PORT} 번이 이미 쓰이고 있어 ${port} 번으로 열렸습니다. `
        + `터널 명령도 ${port} 번으로 맞춰 주세요.`
      : null,
  };
}
