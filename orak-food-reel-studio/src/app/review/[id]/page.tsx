"use client";
import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, LoadGate, ErrorBox, api, mediaUrl, useApi } from "@/components/ui";
import { FieldStatusBadge } from "@/components/RestaurantForm";
import type { FactCheckItem } from "@/lib/schema";
import type { FormValue } from "@/components/RestaurantForm";

interface VideoInfo {
  exists: boolean; sizeText: string; width: number | null; height: number | null;
  ratio: string; durationSec: number | null; hasAudio: boolean | null;
  hasSubtitleFile: boolean; verticalOk: boolean | null; notes: string[];
}
interface ReviewData {
  reel: {
    id: string; title: string; status: string; caption: string; hashtags: string[];
    video_path: string | null; thumb_path: string | null; planned_date: string | null;
    videoFile: string; voiceFile: string; srtFile: string;
  };
  scenes: Array<{ scene: number; subtitle: string; image_path: string | null; fact_source: string }>;
  video: VideoInfo;
  facts: FactCheckItem[];
  quality: { total?: number; fact_blocked?: boolean; image_notice?: string; voice_notice?: string };
  restaurant: FormValue | null;
  review: { checks: Record<string, boolean>; done: boolean; missing: string[]; checkedAt: string | null };
  items: Array<{ key: string; label: string }>;
  blockReason: string | null;
}

/** 값 하나를 이름표와 함께 (모르면 "확인 못 함" — 지어내지 않는다) */
function Fact({ label, value, tone }: { label: string; value: string; tone?: "warn" | "ok" }) {
  return (
    <div className="flex justify-between gap-3 py-1.5 border-b border-gray-100 last:border-0">
      <span className="text-gray-600 shrink-0">{label}</span>
      <span className={`text-right break-words font-bold ${tone === "warn" ? "text-amber-700" : tone === "ok" ? "text-emerald-700" : ""}`}>{value}</span>
    </div>
  );
}

export default function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data, error, reload } = useApi<ReviewData>(`/api/reels/${id}/review`);
  const [checks, setChecks] = useState<Record<string, boolean> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { if (data && checks === null) setChecks(data.review.checks ?? {}); }, [data, checks]);

  if (!data || !checks) return <LoadGate error={error} onRetry={reload} what="완성 콘텐츠" />;
  const { reel, video, facts, restaurant } = data;
  const videoUrl = mediaUrl(reel.video_path);

  const toggle = async (key: string) => {
    const next = { ...checks, [key]: !checks[key] };
    setChecks(next); setErr(null); setMsg(null);
    try {
      await api(`/api/reels/${id}/review`, { method: "PATCH", body: JSON.stringify({ checks: next }) });
      reload();
    } catch (e) {
      setChecks(checks);                                   // 저장 못 했으면 화면도 되돌린다
      setErr(`검수 항목을 저장하지 못했습니다. — ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const doneCount = data.items.filter((i) => checks[i.key]).length;
  const allDone = doneCount === data.items.length;
  const unknownFacts = facts.filter((f) => f.status === "미확인");

  const go = (to: string) => router.push(to);
  /** 음성 등 한 가지를 다시 만들고 영상에 입힌다 */
  const run = async (what: "voice", done: string) => {
    setBusy(true); setErr(null); setMsg(null);
    try {
      await api(`/api/reels/${id}/regenerate`, { method: "POST", body: JSON.stringify({ what }) });
      await api(`/api/reels/${id}/rerender`, { method: "POST", body: "{}" });
      setMsg(done + " 내용이 바뀌었으니 검수를 다시 확인해 주세요.");
      setChecks(null); reload();
    } catch (e) {
      setErr(`다시 만들지 못했습니다. — ${e instanceof Error ? e.message : String(e)}`);
    } finally { setBusy(false); }
  };

  const rebuild = async () => {
    setBusy(true); setErr(null); setMsg(null);
    try {
      await api(`/api/reels/${id}/rerender`, { method: "POST", body: "{}" });
      setMsg("영상을 다시 만들었습니다. 내용이 바뀌었으니 검수를 다시 확인해 주세요.");
      setChecks(null); reload();
    } catch (e) {
      setErr(`영상을 다시 만들지 못했습니다. — ${e instanceof Error ? e.message : String(e)}`);
    } finally { setBusy(false); }
  };

  return (
    <div className="page space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-extrabold min-w-0 break-keep">🔎 완성 콘텐츠 미리보기</h1>
        <button className="btn-ghost ml-auto" onClick={() => go(`/reel/${id}`)}>← 릴스로</button>
      </div>
      <p className="text-gray-700 -mt-2 break-keep">{reel.title}</p>

      <ErrorBox msg={err} />
      {msg && <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-800">{msg}</div>}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,440px)_minmax(0,1fr)] gap-6">
        {/* 왼쪽 — 영상과 정보 */}
        <div className="space-y-4">
          <Card title="🎬 완성 영상">
            {videoUrl ? (
              <video className="w-full rounded-xl bg-black" controls preload="metadata" src={videoUrl} />
            ) : (
              <div className="rounded-xl bg-gray-100 py-20 text-center text-gray-600">
                완성된 영상이 아직 없습니다.
              </div>
            )}
            <div className="text-sm mt-3">
              <Fact label="게시 비율" value={video.ratio === "-" ? "확인 못 함" : video.ratio}
                tone={video.verticalOk === false ? "warn" : video.verticalOk ? "ok" : undefined} />
              <Fact label="해상도" value={video.width && video.height ? `${video.width}×${video.height}` : "확인 못 함"} />
              <Fact label="길이" value={video.durationSec !== null ? `${video.durationSec}초` : "확인 못 함"} />
              <Fact label="파일 크기" value={video.sizeText} />
              {/* 무음 트랙도 "오디오 스트림 있음" 으로 잡힌다 — 생성 실패 기록이 있으면
                  "포함" 이라고 말하지 않는다. 실제로 그렇게 표시돼 사용자가 혼란을 겪었다. */}
              <Fact label="음성"
                value={data.quality.voice_notice ? "무음 (AI 음성 생성 실패)"
                  : video.hasAudio === null ? "확인 못 함" : video.hasAudio ? "포함" : "없음"}
                tone={data.quality.voice_notice || video.hasAudio === false ? "warn" : video.hasAudio ? "ok" : undefined} />
              <Fact label="자막 파일" value={video.hasSubtitleFile ? "포함" : "없음"}
                tone={video.hasSubtitleFile ? "ok" : "warn"} />
            </div>
            {data.quality.voice_notice && (
              <div className="mt-3 rounded-xl bg-amber-50 border-2 border-amber-300 p-3">
                <p className="text-sm text-amber-900 break-words">
                  <b>⚠ AI 음성이 생성되지 않아 무음으로 만들어졌습니다.</b>
                  <br />원인: {data.quality.voice_notice}
                </p>
                <button className="btn-secondary mt-2" disabled={busy}
                  onClick={() => void run("voice", "음성을 다시 만들고 영상에 입혔습니다. 재생해서 확인해 주세요.")}>
                  {busy ? "다시 만드는 중…" : "🎙 음성 다시 만들기"}
                </button>
              </div>
            )}
            {data.quality.image_notice && (
              <p className="mt-3 rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900 break-words">
                ⚠ {data.quality.image_notice}
                <br />릴스 화면의 [이미지 다시] 로 다시 만들 수 있습니다. 설정 → 이미지 생성에서 공급자·키를 확인해 주세요.
              </p>
            )}
            {video.notes.length > 0 && (
              <ul className="mt-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3 list-disc pl-6 space-y-1">
                {video.notes.map((n) => <li key={n}>{n}</li>)}
              </ul>
            )}
          </Card>

          <Card title="🔎 팩트체크">
            <div className="space-y-1.5 text-sm">
              {facts.map((f) => (
                <div key={f.field} className="flex justify-between gap-2">
                  <span className="text-gray-600 font-semibold shrink-0">{f.field}</span>
                  <span className="truncate text-right">{f.value}</span>
                  <FieldStatusBadge status={f.status} />
                </div>
              ))}
              {facts.length === 0 && <div className="text-gray-600">팩트체크 기록이 없습니다.</div>}
            </div>
            {unknownFacts.length > 0 && (
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3 mt-3">
                확인되지 않은 업체 정보가 있습니다. 내용을 확인한 후 게시해 주세요.
                <br /><b>{unknownFacts.map((f) => f.field).join(", ")}</b>
              </p>
            )}
          </Card>

          {restaurant && (
            <Card title="🍽 업체 정보 요약">
              <div className="text-sm">
                <Fact label="매장명" value={restaurant.name || "확인 필요"} />
                <Fact label="주소" value={restaurant.address || "확인 필요"} />
                <Fact label="영업시간" value={restaurant.hours || "확인 필요"} />
                <Fact label="휴무" value={restaurant.closed_days || "확인 필요"} />
                <Fact label="메뉴·가격" value={restaurant.menus_text.split("\n").join(" · ") || "확인 필요"} />
              </div>
            </Card>
          )}
        </div>

        {/* 오른쪽 — 게시문, 이미지, 검수 */}
        <div className="space-y-4">
          <Card title="📝 게시문 · 해시태그">
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm whitespace-pre-wrap break-words">
              {reel.caption || <span className="text-gray-500">본문이 비어 있습니다.</span>}
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {reel.hashtags.map((h) => <span key={h} className="badge bg-[#FDEDE5] text-[#B84A1B]">{h}</span>)}
              {reel.hashtags.length === 0 && <span className="text-sm text-gray-500">해시태그가 없습니다.</span>}
            </div>
          </Card>

          <Card title={`🖼 사용 이미지 ${data.scenes.length}장`}>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {data.scenes.map((s) => {
                const u = mediaUrl(s.image_path);
                return (
                  <div key={s.scene} className="min-w-0">
                    {u
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={u} alt={`SCENE ${s.scene}`} className="w-full aspect-[9/16] object-cover rounded-lg border border-gray-200" />
                      : <div className="w-full aspect-[9/16] rounded-lg bg-gray-100 border border-gray-200" />}
                    <div className="text-[11px] text-gray-600 mt-1 truncate" title={s.subtitle}>#{s.scene} {s.subtitle}</div>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card title={`✅ 발행 전 검수 ${doneCount}/${data.items.length}`}>
            <p className="text-sm text-gray-600 mb-3">
              다섯 항목을 모두 확인해야 발행할 수 있습니다. 눈으로 직접 확인하고 눌러 주세요.
            </p>
            <div className="space-y-2">
              {data.items.map((it) => (
                <label key={it.key} className="flex items-start gap-3 rounded-xl border-2 border-gray-200 p-3 cursor-pointer hover:border-[#E86A3A] transition">
                  <input type="checkbox" className="mt-1 w-5 h-5 accent-[#E86A3A] shrink-0"
                    checked={!!checks[it.key]} onChange={() => void toggle(it.key)} />
                  <span className="text-sm font-bold break-keep">{it.label}</span>
                </label>
              ))}
            </div>

            {data.blockReason && (
              <div className="mt-4 rounded-xl bg-amber-50 border-2 border-amber-300 p-3 text-sm text-amber-900 break-words">
                <b>아직 발행할 수 없습니다</b><br />{data.blockReason}
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              <button className="btn-secondary" onClick={() => go(`/reel/${id}`)}>✏️ 수정하기</button>
              <button className="btn-secondary" disabled={busy} onClick={() => void rebuild()}>
                {busy ? "다시 만드는 중…" : "🎬 영상 다시 만들기"}
              </button>
              <button className="btn-primary" disabled={!allDone || !!data.blockReason}
                title={allDone ? "" : "검수 다섯 항목을 먼저 확인해 주세요"}
                onClick={() => go(`/reel/${id}?publish=schedule`)}>📅 예약 발행</button>
              <button className="btn-primary" disabled={!allDone || !!data.blockReason}
                title={allDone ? "" : "검수 다섯 항목을 먼저 확인해 주세요"}
                onClick={() => go(`/reel/${id}?publish=now`)}>🚀 즉시 발행</button>
              <button className="btn-ghost" onClick={() => go("/publish")}>닫기</button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
