"use client";
import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, StatusBadge, Stars, ErrorBox, api, mediaUrl, useApi } from "@/components/ui";
import type { Scene, ReelScript, FactCheckItem, Verdict } from "@/lib/schema";

interface ReelDetail {
  reel: {
    id: string; title: string; status: string; content_mode: string; content_type: string;
    case_number: number | null; caption: string; hashtags_json: string; quality_json: string;
    factcheck_json: string; video_path: string | null; thumb_path: string | null;
    duration_sec: number | null; planned_date: string | null;
    script: ReelScript | null; scenes: Scene[]; verdict_json: string;
  };
  schedules: Array<{ id: string; publish_at: string; status: string }>;
  posts: Array<{ ig_media_id: string; permalink: string | null; published_at: string }>;
  publishingJobs: Array<{ id: string; phase: string; attempts: number; last_error: string | null }>;
}

export default function ReelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data, error, reload } = useApi<ReelDetail>(`/api/reels/${id}`, 4000);
  const [scenes, setScenes] = useState<Scene[] | null>(null);
  const [caption, setCaption] = useState<string | null>(null);
  const [hashtags, setHashtags] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (data && scenes === null) {
      setScenes(data.reel.scenes);
      setCaption(data.reel.caption);
      setHashtags((JSON.parse(data.reel.hashtags_json || "[]") as string[]).join(" "));
    }
  }, [data, scenes]);

  if (error) return <ErrorBox msg={error} />;
  if (!data || !scenes) return <div className="text-gray-400 py-20 text-center">불러오는 중…</div>;
  const { reel } = data;
  const quality = JSON.parse(reel.quality_json || "{}") as {
    total?: number; pass?: boolean; parts?: Record<string, { score: number; max: number }>;
    suggestions?: string[]; fact_blocked?: boolean; fact_block_reasons?: string[];
    duplicate?: { tooSimilar: boolean; score: number };
    image_notice?: string;
  };
  const facts = JSON.parse(reel.factcheck_json || "[]") as FactCheckItem[];
  const verdict = JSON.parse(reel.verdict_json || "{}") as Partial<Verdict>;
  const videoUrl = mediaUrl(reel.video_path);

  const run = async (label: string, fn: () => Promise<unknown>, doneMsg: string) => {
    setBusy(label); setErr(null); setMsg(null);
    try { await fn(); setMsg(doneMsg); setScenes(null); reload(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  const saveEdits = () => run("save", async () => {
    await api(`/api/reels/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ scenes, caption, hashtags: (hashtags ?? "").split(/\s+/).filter(Boolean) }),
    });
    await api(`/api/reels/${id}/rerender`, { method: "POST", body: "{}" });
  }, "수정 내용을 저장하고 영상을 다시 렌더링했습니다.");

  const move = (i: number, dir: -1 | 1) => {
    const next = [...scenes];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setScenes(next);
  };

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <StatusBadge status={reel.status} />
            {reel.case_number && <span className="badge bg-[#FDEDE5] text-[#E86A3A]">맛집사건 #{String(reel.case_number).padStart(3, "0")}</span>}
            <span className="badge bg-gray-100 text-gray-600">{reel.content_type}</span>
          </div>
          <h1 className="text-2xl font-extrabold mt-2">{reel.title || "제목 없음"}</h1>
          <p className="text-gray-500 text-sm mt-1">{reel.planned_date} · {reel.duration_sec ? `${reel.duration_sec.toFixed(1)}초` : "영상 없음"} · {reel.content_mode === "ORAKI_DETECTIVE" ? "🥟 만두탐정 오락이" : "🍚 일반 맛집"}</p>
        </div>
        <button className="btn-ghost" onClick={() => router.push("/library")}>← 목록</button>
      </header>

      {msg && <div className="card p-3 px-4 bg-emerald-50 border-emerald-200 text-emerald-800 text-sm font-bold">{msg}</div>}
      <ErrorBox msg={err} />
      {quality.image_notice && (
        <div className="card p-4 bg-amber-50 border-amber-300">
          <div className="font-extrabold text-amber-800 mb-1">🖼 임시 이미지가 포함되어 있습니다</div>
          <div className="text-sm text-amber-900">{quality.image_notice}</div>
        </div>
      )}
      {quality.fact_blocked && (
        <div className="card p-4 bg-red-50 border-red-300">
          <div className="font-extrabold text-red-700 mb-1">⚠ 팩트체크 확인 필요 — 해결 전에는 발행할 수 없습니다</div>
          <ul className="text-sm text-red-700 list-disc pl-5">{(quality.fact_block_reasons ?? []).map((r) => <li key={r}>{r}</li>)}</ul>
        </div>
      )}

      <div className="grid grid-cols-[420px_1fr] gap-6">
        {/* 미리보기 */}
        <div className="space-y-4">
          <Card title="🎞 미리보기">
            {videoUrl ? (
              <video key={videoUrl + (reel.duration_sec ?? 0)} src={videoUrl} controls playsInline className="w-full rounded-xl bg-black aspect-9/16" />
            ) : (
              <div className="aspect-9/16 rounded-xl bg-gray-100 flex items-center justify-center text-gray-400">영상이 아직 없습니다</div>
            )}
            <div className="grid grid-cols-2 gap-2 mt-4">
              <button className="btn-primary col-span-2" disabled={!!busy || !reel.video_path || quality.fact_blocked}
                onClick={() => run("schedule", () => api(`/api/reels/${id}/schedule`, { method: "POST", body: "{}" }), "다음 발행 슬롯에 예약했습니다.")}>
                📅 예약 발행 {busy === "schedule" && "…"}
              </button>
              <button className="btn-secondary" disabled={!!busy || !reel.video_path || quality.fact_blocked}
                onClick={() => run("publish", () => api(`/api/reels/${id}/publish`, { method: "POST", body: "{}" }), "발행을 시작했습니다. 아래 발행 상태에서 진행을 확인하세요.")}>
                🚀 지금 발행
              </button>
              <button className="btn-secondary" disabled={!!busy}
                onClick={() => run("remake", () => api("/api/produce", { method: "POST", body: JSON.stringify({ reelId: id, restaurantName: reel.script?.restaurant, contentType: reel.content_type, contentMode: reel.content_mode, durationSec: reel.script?.duration }) }), "다시 만들기를 시작했습니다 — 제작중 메뉴에서 확인하세요.")}>
                🔄 다시 만들기
              </button>
            </div>
            {data.schedules.length > 0 && (
              <div className="mt-4 text-sm space-y-1">
                {data.schedules.map((s) => (
                  <div key={s.id} className="flex justify-between">
                    <span className="text-gray-500">{s.publish_at.replace("T", " ").slice(0, 16)}</span>
                    <StatusBadge status={s.status} />
                  </div>
                ))}
              </div>
            )}
            {data.posts.map((p) => (
              <a key={p.ig_media_id} href={p.permalink ?? "#"} target="_blank" className="block mt-2 text-sm font-bold text-[#E86A3A]">
                ↗ Instagram에서 보기
              </a>
            ))}
            {data.publishingJobs.filter((jb) => jb.phase === "실패").slice(0, 1).map((jb) => (
              <div key={jb.id} className="mt-3">
                <ErrorBox msg={`발행 실패: ${jb.last_error ?? "알 수 없는 오류"}`} />
                <button className="btn-danger mt-2 w-full" disabled={!!busy}
                  onClick={() => run("retry", () => api(`/api/reels/${id}/retry`, { method: "POST", body: "{}" }), "재발행을 시작했습니다.")}>
                  ♻️ 재발행 시도
                </button>
              </div>
            ))}
          </Card>

          {quality.total !== undefined && (
            <Card title={`🧪 품질 점수 — ${quality.total}점 ${quality.pass ? "✅" : "⚠️ 80점 미만"}`}>
              <div className="space-y-1.5 text-sm">
                {Object.entries(quality.parts ?? {}).map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <span className="text-gray-600 font-semibold">{k}</span>
                    <span className="font-bold">{v.score}/{v.max}</span>
                  </div>
                ))}
              </div>
              {(quality.suggestions?.length ?? 0) > 0 && (
                <div className="mt-3 rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">
                  <b>AI 수정 제안</b>
                  <ul className="list-disc pl-4 mt-1 space-y-0.5">{quality.suggestions!.map((s) => <li key={s}>{s}</li>)}</ul>
                </div>
              )}
              {quality.duplicate?.tooSimilar && <div className="mt-2 text-xs font-bold text-red-600">⚠ 최근 콘텐츠와 유사도 {Math.round((quality.duplicate.score) * 100)}% — 재생성을 권장합니다</div>}
            </Card>
          )}

          {verdict?.한줄판정 && (
            <Card title="🕵️ 오락이 탐정 판정">
              <div className="text-lg font-extrabold text-[#E86A3A] mb-2">“{verdict.한줄판정}”</div>
              <div className="grid grid-cols-2 gap-1 text-sm">
                <div>가성비 <Stars n={verdict.가성비 ?? 0} /></div>
                <div>맛 <Stars n={verdict.맛 ?? 0} /></div>
                <div>양 <Stars n={verdict.양 ?? 0} /></div>
                <div>재방문 <Stars n={verdict.재방문 ?? 0} /></div>
              </div>
              <p className="text-[11px] text-gray-400 mt-2">* 오락푸드 자체 콘텐츠 평가입니다 (실사용자 리뷰 아님)</p>
            </Card>
          )}

          <Card title="🔎 팩트체크">
            <div className="space-y-1.5 text-sm">
              {facts.map((f) => (
                <div key={f.field} className="flex justify-between gap-2">
                  <span className="text-gray-600 font-semibold shrink-0">{f.field}</span>
                  <span className="truncate text-right">{f.value}</span>
                  <span className={`badge shrink-0 ${f.status === "확인" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>
                    {f.status === "확인" ? "확인" : "⚠ 확인 필요"}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* 편집 (§46) */}
        <div className="space-y-4">
          <Card title="🎬 장면 편집" right={
            <button className="btn-primary px-4 py-2 text-sm" disabled={!!busy} onClick={saveEdits}>
              {busy === "save" ? "저장·재렌더링 중…" : "💾 저장하고 영상 다시 만들기"}
            </button>
          }>
            <div className="space-y-3">
              {scenes.map((s, i) => (
                <div key={s.scene + "-" + i} className="rounded-xl border border-gray-200 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="badge bg-gray-800 text-white">SCENE {i + 1}</span>
                    <span className="text-xs text-gray-400">{s.start}s ~ {s.end}s</span>
                    {s.character_action && <span className="badge bg-[#FDEDE5] text-[#E86A3A]">🥟 {s.character_action}</span>}
                    <div className="ml-auto flex gap-1">
                      <button className="btn-ghost px-2 py-1" onClick={() => move(i, -1)} title="위로">↑</button>
                      <button className="btn-ghost px-2 py-1" onClick={() => move(i, 1)} title="아래로">↓</button>
                      <button className="btn-ghost px-2 py-1 text-red-500" onClick={() => setScenes(scenes.filter((_, x) => x !== i))} title="장면 삭제">🗑</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-[96px_1fr] gap-3">
                    {mediaUrl(s.image_path) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={mediaUrl(s.image_path)!} alt="" className="w-24 aspect-9/16 object-cover rounded-lg border" />
                    ) : <div className="w-24 aspect-9/16 bg-gray-100 rounded-lg" />}
                    <div className="space-y-2">
                      <div>
                        <span className="text-xs font-bold text-gray-500">나레이션</span>
                        <textarea className="input py-2 text-sm" rows={2} value={s.narration}
                          onChange={(e) => setScenes(scenes.map((x, xi) => xi === i ? { ...x, narration: e.target.value } : x))} />
                      </div>
                      <div>
                        <span className="text-xs font-bold text-gray-500">자막 (한 줄 8~15자, 최대 2줄)</span>
                        <textarea className="input py-2 text-sm" rows={2} value={s.subtitle}
                          onChange={(e) => setScenes(scenes.map((x, xi) => xi === i ? { ...x, subtitle: e.target.value } : x))} />
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <label className="text-xs font-bold text-gray-500">길이(초)</label>
                        <input type="number" step="0.5" min="1.2" className="input w-24 py-1.5 text-sm" value={(s.end - s.start).toFixed(1)}
                          onChange={(e) => {
                            const len = Math.max(1.2, parseFloat(e.target.value) || 2);
                            setScenes(scenes.map((x, xi) => xi === i ? { ...x, end: x.start + len } : x));
                          }} />
                        <button className="btn-ghost text-xs" disabled={!!busy}
                          onClick={() => run(`img${i}`, () => api(`/api/reels/${id}/regenerate`, { method: "POST", body: JSON.stringify({ scene: s.scene, what: "image" }) }), `SCENE ${i + 1} 이미지를 다시 만들었습니다. 저장하면 영상에 반영됩니다.`)}>
                          {busy === `img${i}` ? "생성 중…" : "🖼 이미지만 다시"}
                        </button>
                        <button className="btn-ghost text-xs" disabled={!!busy}
                          onClick={() => run(`voice${i}`, () => api(`/api/reels/${id}/regenerate`, { method: "POST", body: JSON.stringify({ scene: s.scene, what: "voice" }) }), "음성을 다시 만들었습니다. 저장하면 영상에 반영됩니다.")}>
                          {busy === `voice${i}` ? "생성 중…" : "🎙 음성 전체 다시"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card title="📝 Instagram 본문 · 해시태그">
            <label className="label text-sm">본문 (Caption)</label>
            <textarea className="input text-sm" rows={8} value={caption ?? ""} onChange={(e) => setCaption(e.target.value)} />
            <label className="label text-sm mt-3">해시태그 (공백으로 구분, 5~12개 권장)</label>
            <textarea className="input text-sm" rows={2} value={hashtags ?? ""} onChange={(e) => setHashtags(e.target.value)} />
          </Card>
        </div>
      </div>
    </div>
  );
}
