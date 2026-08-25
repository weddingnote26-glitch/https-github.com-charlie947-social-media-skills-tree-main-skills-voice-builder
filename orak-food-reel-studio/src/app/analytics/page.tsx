"use client";
import { useState } from "react";
import Link from "next/link";
import { Card, api, useApi, ErrorBox } from "@/components/ui";

interface Analytics {
  recent: Array<{ id: string; title: string; planned_date: string; content_mode: string; content_type: string; permalink: string | null; metrics_json: string | null }>;
  patterns: { insights: Array<{ dimension: string; best: string; detail: string }>; sampleSize: number };
}

export default function AnalyticsPage() {
  const { data, reload } = useApi<Analytics>("/api/analytics");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const collect = async () => {
    setBusy(true); setErr(null);
    try { await api("/api/analytics", { method: "POST", body: "{}" }); reload(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const METRIC_KO: Record<string, string> = { views: "조회", reach: "도달", likes: "좋아요", comments: "댓글", saved: "저장", shares: "공유", total_interactions: "상호작용" };

  return (
    <div className="page space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-extrabold">📊 성과분석</h1>
          <p className="text-gray-600 mt-1">Instagram API가 제공하는 지표만 저장합니다. 제공되지 않는 값은 표시하지 않습니다.</p>
        </div>
        <button className="btn-secondary" onClick={collect} disabled={busy}>{busy ? "수집 중…" : "📥 지표 지금 수집"}</button>
      </header>
      <ErrorBox msg={err} />

      <Card title="🧠 구조 인사이트 — 어떤 구성이 상대적으로 좋았나">
        <div className="space-y-3">
          {(data?.patterns.insights ?? []).map((i) => (
            <div key={i.dimension} className="rounded-xl border border-gray-200 p-3">
              <div className="text-sm font-extrabold text-[#B84A1B]">{i.dimension}: {i.best}</div>
              <div className="text-sm text-gray-600 mt-0.5">{i.detail}</div>
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-600 mt-3">* 단순 최고 조회수 복제가 아니라 구조 단위의 상대 비교입니다. (표본 {data?.patterns.sampleSize ?? 0}편)</p>
      </Card>

      <Card title="발행 콘텐츠 성과">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-gray-600 font-bold border-b">
            <th className="py-2">콘텐츠</th><th>게시일</th><th>지표</th><th></th>
          </tr></thead>
          <tbody>
            {(data?.recent ?? []).map((r) => {
              const m = r.metrics_json ? JSON.parse(r.metrics_json) as Record<string, number> : null;
              return (
                <tr key={r.id} className="border-b border-gray-100">
                  <td className="py-2.5"><Link href={`/reel/${r.id}`} className="font-bold hover:text-[#B84A1B]">{r.content_mode === "ORAKI_DETECTIVE" ? "🥟 " : ""}{r.title}</Link></td>
                  <td className="text-gray-600">{r.planned_date}</td>
                  <td className="text-gray-700">{m ? Object.entries(m).map(([k, v]) => `${METRIC_KO[k] ?? k} ${v.toLocaleString()}`).join(" · ") : "수집 전"}</td>
                  <td>{r.permalink && <a className="text-[#B84A1B] font-bold" href={r.permalink} target="_blank">↗</a>}</td>
                </tr>
              );
            })}
            {(data?.recent?.length ?? 0) === 0 && <tr><td colSpan={4} className="text-center text-gray-600 py-10">발행된 콘텐츠가 아직 없습니다.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
