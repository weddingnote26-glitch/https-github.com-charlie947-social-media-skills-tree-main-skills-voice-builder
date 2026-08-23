"use client";
import { useState } from "react";
import { Card, api, useApi, ErrorBox } from "@/components/ui";

interface Bm { id: string; source_url: string; analysis_json: string; template_json: string; created_at: string }

const FIELD_KO: Record<string, string> = {
  hook_structure: "HOOK 구조", estimated_length: "예상 길이", scene_structure: "SCENE 구조",
  subtitle_style: "자막 스타일", info_layout: "정보 배치", cta_structure: "CTA 구조", tempo: "템포", note: "메모",
};

export default function BenchmarkPage() {
  const { data, reload } = useApi<{ benchmarks: Bm[] }>("/api/benchmark");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const analyze = async () => {
    setBusy(true); setErr(null);
    try { await api("/api/benchmark", { method: "POST", body: JSON.stringify({ url }) }); setUrl(""); reload(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="page space-y-6">
      <header>
        <h1 className="text-2xl font-extrabold">🔍 릴스 벤치마킹</h1>
        <p className="text-gray-600 mt-1">콘텐츠의 구조와 연출 방식만 분석합니다. 원본 영상·문구는 복제하지 않습니다.</p>
      </header>
      <Card>
        <div className="flex gap-3">
          <input className="input flex-1" placeholder="릴스 URL 입력 (예: https://www.instagram.com/reel/...)" value={url} onChange={(e) => setUrl(e.target.value)} />
          <button className="btn-primary" onClick={analyze} disabled={busy || !url.trim()}>{busy ? "분석 중…" : "분석"}</button>
        </div>
      </Card>
      <ErrorBox msg={err} />
      {(data?.benchmarks ?? []).map((b) => {
        const a = JSON.parse(b.analysis_json) as Record<string, string>;
        return (
          <Card key={b.id} title={b.source_url.slice(0, 60)} right={<span className="text-xs text-gray-600">{b.created_at.slice(0, 10)}</span>}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              {Object.entries(a).map(([k, v]) => (
                <div key={k} className="rounded-xl bg-gray-50 p-3">
                  <div className="text-xs font-extrabold text-gray-600 mb-1">{FIELD_KO[k] ?? k}</div>
                  <div className="font-semibold">{v}</div>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-600 mt-3">💾 오락푸드용 재구성 템플릿으로 저장되어 다음 대본 생성에 참고됩니다.</p>
          </Card>
        );
      })}
    </div>
  );
}
