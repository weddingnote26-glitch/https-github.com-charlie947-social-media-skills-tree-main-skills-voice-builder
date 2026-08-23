import { db, j } from "./db";
import { newId } from "./id";
import { getPublisher } from "./providers/instagram";
import { logWarn } from "./log";

/** §35 성과 수집 — API 제공 지표만 저장 */
export async function collectInsights(): Promise<number> {
  const posts = db().prepare(
    "SELECT p.id, p.reel_id, p.ig_media_id FROM instagram_posts p"
  ).all() as Array<{ id: string; reel_id: string; ig_media_id: string }>;
  const publisher = getPublisher();
  let saved = 0;
  for (const p of posts) {
    try {
      const metrics = await publisher.getInsights(p.ig_media_id);
      if (Object.keys(metrics).length === 0) continue;
      db().prepare("INSERT INTO analytics (id, reel_id, ig_media_id, metrics_json) VALUES (?,?,?,?)")
        .run(newId("an"), p.reel_id, p.ig_media_id, JSON.stringify(metrics));
      saved++;
    } catch (e) {
      logWarn("analytics", `지표 수집 실패(${p.ig_media_id}): ${e instanceof Error ? e.message : e}`);
    }
  }
  return saved;
}

export interface PatternInsight {
  dimension: string;
  best: string;
  detail: string;
}

/**
 * §36 AI 학습 피드백 — 단순 최고 조회수 복제가 아니라
 * "어떤 구조가 상대적으로 성과가 좋았는지"를 요약.
 */
export function analyzePatterns(): { insights: PatternInsight[]; sampleSize: number } {
  const rows = db().prepare(`
    SELECT r.id, r.content_type, r.content_mode, r.duration_sec, r.script_json,
      (SELECT metrics_json FROM analytics a WHERE a.reel_id = r.id ORDER BY captured_at DESC LIMIT 1) AS metrics_json
    FROM reels r WHERE r.status='발행완료'
  `).all() as Array<{ id: string; content_type: string; content_mode: string; duration_sec: number | null; script_json: string; metrics_json: string | null }>;

  const withMetrics = rows
    .map((r) => {
      const m = j<Record<string, number>>(r.metrics_json ?? "", {});
      const s = j<{ hook?: string; scenes?: unknown[] }>(r.script_json, {});
      const engagement = (m.views ?? m.reach ?? 0) === 0
        ? 0
        : ((m.likes ?? 0) + (m.comments ?? 0) + (m.saved ?? 0) * 2 + (m.shares ?? 0) * 2) / Math.max(1, m.views ?? m.reach ?? 1);
      return { ...r, metrics: m, engagement, views: m.views ?? m.reach ?? 0, hookLen: (s.hook ?? "").length, sceneCount: s.scenes?.length ?? 0 };
    })
    .filter((r) => Object.keys(r.metrics).length > 0);

  if (withMetrics.length < 3) {
    return { insights: [{ dimension: "데이터", best: "-", detail: `발행 후 지표가 3개 이상 쌓이면 구조 분석을 제공합니다. (현재 ${withMetrics.length}개)` }], sampleSize: withMetrics.length };
  }

  const insights: PatternInsight[] = [];
  const byGroup = (keyFn: (r: (typeof withMetrics)[number]) => string, dim: string) => {
    const groups = new Map<string, { sum: number; n: number }>();
    for (const r of withMetrics) {
      const k = keyFn(r);
      const g = groups.get(k) ?? { sum: 0, n: 0 };
      g.sum += r.engagement; g.n++;
      groups.set(k, g);
    }
    const ranked = [...groups.entries()].map(([k, g]) => ({ k, avg: g.sum / g.n, n: g.n }))
      .filter((g) => g.n >= 2).sort((a, b) => b.avg - a.avg);
    if (ranked.length >= 2) {
      insights.push({
        dimension: dim, best: ranked[0].k,
        detail: `${ranked[0].k}(${ranked[0].n}편)의 평균 반응률이 ${ranked[ranked.length - 1].k} 대비 ${((ranked[0].avg / Math.max(0.0001, ranked[ranked.length - 1].avg)) * 100 - 100).toFixed(0)}% 높습니다.`,
      });
    }
  };
  byGroup((r) => r.content_type, "콘텐츠 유형");
  byGroup((r) => r.content_mode === "ORAKI_DETECTIVE" ? "오락이 탐정" : "일반 맛집", "캐릭터 모드");
  byGroup((r) => (r.duration_sec ?? 0) <= 24 ? "24초 이하" : "25초 이상", "영상 길이");
  byGroup((r) => r.hookLen <= 18 ? "짧은 훅(≤18자)" : "긴 훅", "HOOK 길이");
  byGroup((r) => r.sceneCount <= 8 ? "8장면 이하" : "9장면 이상", "장면 수");

  return { insights, sampleSize: withMetrics.length };
}
