import { getEnv } from "../env";
import { isSampleMode } from "../secrets";
import { kvGet } from "../settings";
import { decrypt } from "../crypto";
import { ApiError, fetchJson, withRetry } from "./http";
import { describeKeyFailure } from "./api-failure";
import type { ContainerStatus, PublishingProvider } from "./types";

const GRAPH = "https://graph.facebook.com/v21.0";

/** 토큰: 설정화면에서 암호화 저장한 값 우선, 없으면 .env */
export function resolveIgAuth(): { token: string; userId: string } {
  const env = getEnv();
  let token = env.INSTAGRAM_ACCESS_TOKEN;
  const stored = kvGet("ig_token_encrypted");
  if (stored) {
    try { token = decrypt(stored); } catch { /* 손상 시 env로 폴백 */ }
  }
  const userId = kvGet("ig_user_id") ?? env.INSTAGRAM_USER_ID;
  return { token, userId: typeof userId === "string" ? userId : env.INSTAGRAM_USER_ID };
}

/**
 * 화면 표시용 — 토큰 전체는 절대 돌려주지 않고 "저장돼 있는지"와 앞뒤 몇 글자만.
 *
 * 저장한 토큰은 보안상 입력칸에 다시 채워 넣지 않는다. 그러다 보니 칸이 비어 있는데
 * 연결 테스트는 저장된 값으로 돌아가서, 빈 칸을 보며 400 을 받는 상황이 생겼다.
 */
export function igAuthStatus(): {
  tokenSet: boolean; tokenSource: "설정" | ".env" | "없음"; tokenHint: string;
  userIdSet: boolean; userIdSource: "설정" | ".env" | "없음"; userId: string;
} {
  const env = getEnv();
  const storedToken = kvGet("ig_token_encrypted");
  let token = "";
  if (storedToken) {
    try { token = decrypt(storedToken); } catch { token = ""; }
  }
  const tokenSource = token ? "설정" : env.INSTAGRAM_ACCESS_TOKEN ? ".env" : "없음";
  if (!token) token = env.INSTAGRAM_ACCESS_TOKEN;

  const storedId = kvGet("ig_user_id");
  const userId = storedId || env.INSTAGRAM_USER_ID;
  const userIdSource = storedId ? "설정" : env.INSTAGRAM_USER_ID ? ".env" : "없음";

  return {
    tokenSet: !!token,
    tokenSource,
    // 토큰은 길다 — 같은 값인지 알아볼 수 있을 만큼만
    tokenHint: token ? `${token.slice(0, 6)}…${token.slice(-4)} (${token.length}자)` : "",
    userIdSet: !!userId,
    userIdSource,
    userId, // 계정 ID 는 비밀이 아니다 — 그대로 보여줘야 확인이 된다
  };
}

/**
 * 발행 실패를 사용자가 다음에 할 일이 보이는 문장으로.
 * Meta 가 돌려주는 영어 JSON 을 그대로 남기면 무엇을 고쳐야 할지 알 수 없다.
 */
export function friendlyInstagramError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const status = e instanceof ApiError ? e.status : Number(msg.match(/^\s*(\d{3})\b/)?.[1] ?? 0);
  if (status) return describeKeyFailure("instagram", status, msg);
  return msg.slice(0, 300);
}

/** §31~32 Meta 공식 Instagram API (Professional 계정) */
class GraphPublisher implements PublishingProvider {
  readonly name = "instagram-graph";

  async createReelContainer(req: { videoUrl: string; caption: string; coverUrl?: string }): Promise<{ containerId: string }> {
    const { token, userId } = resolveIgAuth();
    return withRetry("instagram", "create-container", async () => {
      const out = await fetchJson<{ id: string }>("instagram", `${GRAPH}/${userId}/media`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          media_type: "REELS",
          video_url: req.videoUrl,
          caption: req.caption,
          share_to_feed: true,
          ...(req.coverUrl ? { cover_url: req.coverUrl } : {}),
          access_token: token,
        }),
      });
      return { containerId: out.id };
    });
  }

  async getContainerStatus(containerId: string): Promise<{ status: ContainerStatus; detail?: string }> {
    const { token } = resolveIgAuth();
    const out = await fetchJson<{ status_code?: ContainerStatus; status?: string }>(
      "instagram",
      `${GRAPH}/${containerId}?fields=status_code,status&access_token=${encodeURIComponent(token)}`,
      { method: "GET" },
    );
    return { status: out.status_code ?? "IN_PROGRESS", detail: out.status };
  }

  async publish(containerId: string): Promise<{ mediaId: string }> {
    const { token, userId } = resolveIgAuth();
    return withRetry("instagram", "publish", async () => {
      const out = await fetchJson<{ id: string }>("instagram", `${GRAPH}/${userId}/media_publish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ creation_id: containerId, access_token: token }),
      });
      return { mediaId: out.id };
    });
  }

  async getPermalink(mediaId: string): Promise<string> {
    const { token } = resolveIgAuth();
    const out = await fetchJson<{ permalink?: string }>(
      "instagram",
      `${GRAPH}/${mediaId}?fields=permalink&access_token=${encodeURIComponent(token)}`,
      { method: "GET" },
    );
    return out.permalink ?? "";
  }

  /** §35 성과 — API가 제공하는 지표만 저장, 임의 생성 금지 */
  async getInsights(mediaId: string): Promise<Record<string, number>> {
    const { token } = resolveIgAuth();
    const metrics = "views,reach,likes,comments,saved,shares,total_interactions";
    const out = await fetchJson<{ data?: Array<{ name: string; values?: Array<{ value: number }> }> }>(
      "instagram",
      `${GRAPH}/${mediaId}/insights?metric=${metrics}&access_token=${encodeURIComponent(token)}`,
      { method: "GET" },
    );
    const result: Record<string, number> = {};
    for (const m of out.data ?? []) {
      const v = m.values?.[0]?.value;
      if (typeof v === "number") result[m.name] = v;
    }
    return result;
  }
}

/** Sample Mode — 발행 흐름 시뮬레이션 (컨테이너 2회 조회 후 FINISHED) */
class SamplePublisher implements PublishingProvider {
  readonly name = "sample";
  private static polls = new Map<string, number>();

  async createReelContainer(): Promise<{ containerId: string }> {
    const id = `sample-container-${Date.now()}`;
    SamplePublisher.polls.set(id, 0);
    return { containerId: id };
  }
  async getContainerStatus(containerId: string): Promise<{ status: ContainerStatus }> {
    const n = (SamplePublisher.polls.get(containerId) ?? 0) + 1;
    SamplePublisher.polls.set(containerId, n);
    return { status: n >= 2 ? "FINISHED" : "IN_PROGRESS" };
  }
  async publish(containerId: string): Promise<{ mediaId: string }> {
    return { mediaId: containerId.replace("container", "media") };
  }
  async getPermalink(mediaId: string): Promise<string> {
    return `https://www.instagram.com/reel/SAMPLE_${mediaId.slice(-6)}/`;
  }
  async getInsights(): Promise<Record<string, number>> {
    return {}; // 샘플에서는 지표를 만들어내지 않음 (§35)
  }
}

export function getPublisher(): PublishingProvider {
  const env = getEnv();
  const { token, userId } = resolveIgAuth();
  if (isSampleMode() || !token || !userId) return new SamplePublisher();
  return new GraphPublisher();
}
