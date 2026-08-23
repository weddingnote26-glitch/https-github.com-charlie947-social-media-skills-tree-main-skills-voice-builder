import { getEnv } from "../env";
import { kvGet } from "../settings";
import { decrypt } from "../crypto";
import { fetchJson, withRetry } from "./http";
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
  if (env.APP_MODE === "sample" || !token || !userId) return new SamplePublisher();
  return new GraphPublisher();
}
