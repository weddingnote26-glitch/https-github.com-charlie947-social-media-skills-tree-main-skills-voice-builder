"use client";
import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, StatusBadge, Stars, ErrorBox, api, mediaUrl, useApi, canOpenFolder, openOutputFolder, copyText } from "@/components/ui";
import RestaurantForm, { FieldStatusBadge, type FormValue } from "@/components/RestaurantForm";
import PublishDialog from "@/components/PublishDialog";
import ScheduleDialog from "@/components/ScheduleDialog";
import type { Scene, ReelScript, FactCheckItem, Verdict } from "@/lib/schema";

interface ReelDetail {
  reel: {
    id: string; title: string; status: string; content_mode: string; content_type: string;
    case_number: number | null; caption: string; hashtags_json: string; quality_json: string;
    factcheck_json: string; video_path: string | null; thumb_path: string | null;
    duration_sec: number | null; planned_date: string | null; output_dir: string | null;
    script: ReelScript | null; scenes: Scene[]; verdict_json: string;
  };
  restaurant: FormValue | null;
  schedules: Array<{ id: string; publish_at: string; status: string }>;
  posts: Array<{ ig_media_id: string; permalink: string | null; published_at: string }>;
  publishingJobs: Array<{ id: string; phase: string; attempts: number; last_error: string | null; updated_at?: string | null }>;
}

/** 제작 화면의 세 단계 — 순서대로 일하게 탭으로 나눈다 */
type Tab = "info" | "scenes" | "preview";
const TABS: Array<{ key: Tab; label: string }> = [
  { key: "info", label: "① 업체 정보 입력" },
  { key: "scenes", label: "② 장면 편집" },
  { key: "preview", label: "③ 미리보기 · 발행" },
];

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
  /** §7 실제 게시 전 최종 확인창 */
  const [confirmPublish, setConfirmPublish] = useState(false);
  /** §8 예약 시각 고르기 창 */
  const [schedOpen, setSchedOpen] = useState(false);
  /* 탭은 화면만 바꾼다 — 상태는 전부 이 컴포넌트에 있으므로
     탭을 오가도 치던 글자와 장면 수정이 사라지지 않는다. */
  const [tab, setTab] = useState<Tab | null>(null);
  /** 장면 목록에서 고른 장면 — 고른 것만 오른쪽에서 편집한다 */
  const [sel, setSel] = useState(0);

  // 검수 화면에서 ?publish=now / ?publish=schedule 로 넘어오면 그 창을 바로 연다.
  useEffect(() => {
    const want = new URLSearchParams(window.location.search).get("publish");
    if (want === "now") { setConfirmPublish(true); setTab("preview"); }
    else if (want === "schedule") { setSchedOpen(true); setTab("preview"); }
    if (want) window.history.replaceState(null, "", window.location.pathname);
  }, []);

  useEffect(() => {
    if (data && scenes === null) {
      setScenes(data.reel.scenes);
      setCaption(data.reel.caption);
      setHashtags((JSON.parse(data.reel.hashtags_json || "[]") as string[]).join(" "));
      // 첫 진입: 영상이 있으면 미리보기, 없으면 업체 정보부터
      setTab((cur) => cur ?? (data.reel.video_path ? "preview" : "info"));
    }
  }, [data, scenes]);

  /** 클립보드에 담고 결과를 알린다 (복사는 한 번만 시도한다) */
  const copyAnd = async (what: string, text: string | null) => {
    setErr(null);
    if (!text) { setErr(`${what} 칸이 비어 있습니다.`); return; }
    if (await copyText(text)) setMsg(`${what} 복사 완료 — Instagram 에 붙여넣으세요.`);
    else setErr(`${what} 복사에 실패했습니다 — 아래 칸에서 직접 선택해 복사해 주세요.`);
  };

  /** 완성 영상 폴더 열기 (설치형 앱에서만) */
  const openFolder = async () => {
    setErr(null);
    const folder = (data?.reel.output_dir ?? "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
    const r = await openOutputFolder(folder);
    if (!r.ok) setErr(r.reason ?? "폴더를 열지 못했습니다.");
  };

  if (error) return <ErrorBox msg={error} />;
  if (!data || !scenes || tab === null) return <div className="text-gray-600 py-20 text-center">불러오는 중…</div>;
  const { reel } = data;
  const quality = JSON.parse(reel.quality_json || "{}") as {
    total?: number; pass?: boolean; parts?: Record<string, { score: number; max: number }>;
    suggestions?: string[]; fact_blocked?: boolean; fact_block_reasons?: string[];
    duplicate?: { tooSimilar: boolean; score: number };
    image_notice?: string; voice_notice?: string;
  };
  const facts = JSON.parse(reel.factcheck_json || "[]") as FactCheckItem[];
  const verdict = JSON.parse(reel.verdict_json || "{}") as Partial<Verdict>;
  const videoUrl = mediaUrl(reel.video_path);
  const lastPublishError = data.publishingJobs.find((jb) => jb.phase === "실패")?.last_error ?? null;

  /* 저장하지 않은 수정이 있는지 — 상태를 따로 표시하지 않고 값 자체를 비교한다.
     장면을 고치는 자리가 여러 곳이라 표시 코드를 깜빡하면 거짓말이 되기 때문이다. */
  const scenesDirty = JSON.stringify(scenes) !== JSON.stringify(data.reel.scenes);
  const captionDirty = (caption ?? "") !== data.reel.caption
    || (hashtags ?? "") !== (JSON.parse(data.reel.hashtags_json || "[]") as string[]).join(" ");
  const dirty = scenesDirty || captionDirty;

  const run = async (label: string, fn: () => Promise<unknown>, doneMsg: string) => {
    setBusy(label); setErr(null); setMsg(null);
    try { await fn(); setMsg(doneMsg); setScenes(null); reload(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  /**
   * 저장과 영상 제작은 별개의 단계다.
   * 어느 단계에서 멈췄는지 문장으로 구분해 알린다.
   */
  const saveEdits = async () => {
    setBusy("save"); setErr(null); setMsg(null);
    try {
      await api(`/api/reels/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ scenes, caption, hashtags: (hashtags ?? "").split(/\s+/).filter(Boolean) }),
      });
    } catch (e) {
      setErr(`수정 내용을 저장하지 못했습니다. 다시 시도해 주세요. — ${e instanceof Error ? e.message : String(e)}`);
      setBusy(null);
      return;
    }
    setMsg("수정 내용을 저장했습니다. 이어서 영상을 만듭니다…");
    try {
      await api(`/api/reels/${id}/rerender`, { method: "POST", body: "{}" });
      setMsg("수정 내용을 저장하고 영상을 만들었습니다. [③ 미리보기 · 발행] 에서 확인해 주세요.");
      setScenes(null); reload();
    } catch (e) {
      setErr(`수정 내용은 저장됐지만 영상 제작에 실패했습니다. — ${e instanceof Error ? e.message : String(e)}`);
      setScenes(null); reload();
    } finally { setBusy(null); }
  };

  const move = (i: number, dir: -1 | 1) => {
    const next = [...scenes];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setScenes(next);
    setSel(j);
  };

  /** 고른 장면 뒤에 빈 장면을 하나 끼운다 (번호·시간은 저장할 때 서버가 다시 매긴다) */
  const addScene = () => {
    const base = scenes[sel] ?? scenes[scenes.length - 1];
    const fresh: Scene = {
      scene: scenes.length + 1, start: base?.end ?? 0, end: (base?.end ?? 0) + 2.5,
      narration: "", subtitle: "", visual_prompt: base?.visual_prompt ?? "맛집 소개 장면",
      camera_motion: "slow_zoom_in", character_action: null, character_expression: null,
      character_presence: "none", fact_source: "", image_path: null, image_hash: null,
    };
    const next = [...scenes];
    next.splice(sel + 1, 0, fresh);
    setScenes(next);
    setSel(sel + 1);
  };

  const cur = scenes[Math.min(sel, Math.max(0, scenes.length - 1))];
  const curIdx = Math.min(sel, Math.max(0, scenes.length - 1));

  return (
    <div className="page space-y-5">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={reel.status} />
            {reel.case_number && <span className="badge bg-[#FDEDE5] text-[#B84A1B]">맛집사건 #{String(reel.case_number).padStart(3, "0")}</span>}
            <span className="badge bg-gray-100 text-gray-600">{reel.content_type}</span>
          </div>
          <h1 className="text-2xl font-extrabold mt-2 break-keep">{reel.title || "제목 없음"}</h1>
          <p className="text-gray-600 text-sm mt-1">{reel.planned_date} · {reel.duration_sec ? `${reel.duration_sec.toFixed(1)}초` : "영상 없음"} · {reel.content_mode === "ORAKI_DETECTIVE" ? "🥟 만두탐정 오락이" : "🍚 일반 맛집"}</p>
        </div>
        <button className="btn-ghost shrink-0" onClick={() => router.push("/library")}>← 목록</button>
      </header>

      {/* 작업 순서 탭 — 위에 붙어 다닌다. 탭을 바꿔도 입력값은 사라지지 않는다. */}
      <nav className="sticky top-0 z-30 -mx-1 bg-[#F6F7F9]/95 backdrop-blur px-1 py-2" aria-label="제작 단계">
        <div className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button key={t.key} aria-pressed={tab === t.key}
              className={`min-h-11 px-4 rounded-xl border-2 text-[15px] font-bold transition ${
                tab === t.key
                  ? "border-[#E86A3A] bg-[#E86A3A] text-white"
                  : "border-gray-300 bg-white text-gray-800 hover:border-[#E86A3A]"}`}
              onClick={() => setTab(t.key)}>
              {t.label}
              {t.key === "scenes" && dirty && <span className="ml-1.5 text-xs align-middle">●</span>}
            </button>
          ))}
          {dirty && (
            <span className="self-center text-sm font-bold text-amber-700">
              저장하지 않은 수정이 있습니다 — [② 장면 편집] 의 저장 단추를 눌러 주세요
            </span>
          )}
        </div>
      </nav>

      {msg && <div className="card p-3 px-4 bg-emerald-50 border-emerald-200 text-emerald-800 text-sm font-bold">{msg}</div>}
      <ErrorBox msg={err} />
      {quality.fact_blocked && (
        <div className="card p-4 bg-red-50 border-red-300">
          <div className="font-extrabold text-red-700 mb-1">⚠ 팩트체크 확인 필요 — 해결 전에는 발행할 수 없습니다</div>
          <ul className="text-sm text-red-700 list-disc pl-5">{(quality.fact_block_reasons ?? []).map((r) => <li key={r}>{r}</li>)}</ul>
        </div>
      )}

      {/* ── ① 업체 정보 입력 ─────────────────────────────── */}
      {tab === "info" && (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)] gap-5 items-start">
          <Card title="🔎 팩트체크">
            <div className="space-y-1.5 text-sm">
              {facts.map((f) => (
                <div key={f.field} className="flex justify-between gap-2">
                  <span className="text-gray-600 font-semibold shrink-0">{f.field}</span>
                  <span className="truncate text-right">{f.value}</span>
                  <FieldStatusBadge status={f.status} />
                </div>
              ))}
            </div>
            {facts.some((f) => f.status === "미확인") && (
              <p className="text-xs text-gray-600 mt-3">
                ⚠ 확인 필요 항목은 오른쪽에 직접 적어 넣고 저장하면 확인된 정보로 바뀝니다.
              </p>
            )}
            <button className="btn-primary w-full mt-4" onClick={() => setTab("scenes")}>
              다음 단계 → ② 장면 편집
            </button>
          </Card>
          <div id="업체정보" className="scroll-mt-16">
            <RestaurantForm value={data.restaurant} onSaved={() => reload()} />
          </div>
        </div>
      )}

      {/* ── ② 장면 편집 — 왼쪽 목록, 오른쪽에서 고른 장면만 ── */}
      {tab === "scenes" && (
        <div className="space-y-4">
          <Card title="🎬 장면 편집" right={
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-bold text-gray-700">🖼 이미지 다시:</span>
              {([["character", "오락이만"], ["food", "음식만"], ["background", "배경만"], ["all", "전체"]] as const).map(([scope, label]) => (
                <button key={scope} className="btn-secondary" disabled={!!busy}
                  title={scope === "all" ? "무료 사용량을 가장 많이 씁니다 — 필요한 것만 다시 만드는 편이 좋습니다" : `${label} 장면의 그림만 다시 만듭니다 (대본·음성은 그대로)`}
                  onClick={() => run(`img-${scope}`, () => api(`/api/reels/${id}/regenerate`, { method: "POST", body: JSON.stringify({ what: "image", scope }) }), `${label} 이미지를 다시 만들었습니다. 저장하면 영상에 반영됩니다.`)}>
                  {busy === `img-${scope}` ? "생성 중…" : label}
                </button>
              ))}
              <button className="btn-primary" disabled={!!busy} onClick={saveEdits}>
                {busy === "save" ? "저장하고 만드는 중…" : "💾 저장하고 영상 제작하기"}
              </button>
            </div>
          }>
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4 items-start">
              {/* 왼쪽 — 장면 목록. 전부 펼치지 않는다. */}
              <div className="space-y-2 lg:max-h-[560px] lg:overflow-y-auto pr-1">
                {scenes.map((s, i) => {
                  const thumb = mediaUrl(s.image_path);
                  return (
                    <button key={s.scene + "-" + i} onClick={() => setSel(i)} aria-pressed={curIdx === i}
                      className={`w-full text-left rounded-xl border-2 p-2.5 flex items-center gap-3 transition ${
                        curIdx === i ? "border-[#E86A3A] bg-[#FDEDE5]" : "border-gray-200 bg-white hover:border-gray-300"}`}>
                      {thumb
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={thumb} alt="" className="w-12 aspect-9/16 object-cover rounded-md border shrink-0" />
                        : <div className="w-12 aspect-9/16 bg-gray-100 rounded-md shrink-0 flex items-center justify-center text-xs text-gray-500">없음</div>}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="badge bg-gray-800 text-white">SCENE {i + 1}</span>
                          <span className="text-xs text-gray-600 tabular-nums">{s.start}s~{s.end}s</span>
                        </div>
                        <div className="text-sm truncate mt-1">{s.subtitle || s.narration || "(내용 없음)"}</div>
                        <div className="flex items-center gap-1.5 mt-1">
                          {!s.image_path && <span className="badge bg-amber-100 text-amber-800">이미지 없음</span>}
                          {s.character_action && <span className="badge bg-[#FDEDE5] text-[#B84A1B]">🥟</span>}
                        </div>
                      </div>
                    </button>
                  );
                })}
                <button className="btn-secondary w-full" onClick={addScene}>＋ 장면 추가</button>
              </div>

              {/* 오른쪽 — 고른 장면만 편집 */}
              {cur && (
                <div className="rounded-xl border-2 border-gray-200 p-4">
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    <span className="badge bg-gray-800 text-white">SCENE {curIdx + 1}</span>
                    <span className="text-xs text-gray-600 tabular-nums">{cur.start}s ~ {cur.end}s</span>
                    {cur.character_action && (
                      <span className="badge badge-wrap max-w-full bg-[#FDEDE5] text-[#B84A1B]">🥟 {cur.character_action}</span>
                    )}
                    <div className="ml-auto flex items-center gap-1 shrink-0">
                      <button className="btn-icon" onClick={() => move(curIdx, -1)} title="위로" aria-label={`SCENE ${curIdx + 1} 위로 옮기기`}>↑</button>
                      <button className="btn-icon" onClick={() => move(curIdx, 1)} title="아래로" aria-label={`SCENE ${curIdx + 1} 아래로 옮기기`}>↓</button>
                      <button className="btn-icon text-red-600 hover:bg-red-50" title="장면 삭제" aria-label={`SCENE ${curIdx + 1} 삭제`}
                        onClick={() => { setScenes(scenes.filter((_, x) => x !== curIdx)); setSel(Math.max(0, curIdx - 1)); }}>🗑</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-[96px_1fr] gap-3">
                    {mediaUrl(cur.image_path) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={mediaUrl(cur.image_path)!} alt="" className="w-24 aspect-9/16 object-cover rounded-lg border" />
                    ) : <div className="w-24 aspect-9/16 bg-gray-100 rounded-lg" />}
                    <div className="space-y-2">
                      <div>
                        <span className="text-xs font-bold text-gray-600">나레이션</span>
                        <textarea className="input max-h-28" rows={2} value={cur.narration}
                          onChange={(e) => setScenes(scenes.map((x, xi) => xi === curIdx ? { ...x, narration: e.target.value } : x))} />
                      </div>
                      <div>
                        <span className="text-xs font-bold text-gray-600">자막 (한 줄 8~15자, 최대 2줄)</span>
                        <textarea className="input max-h-24" rows={2} value={cur.subtitle}
                          onChange={(e) => setScenes(scenes.map((x, xi) => xi === curIdx ? { ...x, subtitle: e.target.value } : x))} />
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <label className="text-xs font-bold text-gray-600">길이(초)</label>
                        <input type="number" step="0.5" min="1.2" className="input w-full sm:w-24 min-w-0" value={(cur.end - cur.start).toFixed(1)}
                          onChange={(e) => {
                            const len = Math.max(1.2, parseFloat(e.target.value) || 2);
                            setScenes(scenes.map((x, xi) => xi === curIdx ? { ...x, end: x.start + len } : x));
                          }} />
                        <button className="btn-ghost" disabled={!!busy}
                          onClick={() => run(`img${curIdx}`, () => api(`/api/reels/${id}/regenerate`, { method: "POST", body: JSON.stringify({ scene: cur.scene, what: "image" }) }), `SCENE ${curIdx + 1} 이미지를 다시 만들었습니다. 저장하면 영상에 반영됩니다.`)}>
                          {busy === `img${curIdx}` ? "생성 중…" : "🖼 이미지만 다시"}
                        </button>
                        <button className="btn-ghost" disabled={!!busy}
                          onClick={() => run(`voice${curIdx}`, () => api(`/api/reels/${id}/regenerate`, { method: "POST", body: JSON.stringify({ scene: cur.scene, what: "voice" }) }), "음성을 다시 만들었습니다. 저장하면 영상에 반영됩니다.")}>
                          {busy === `voice${curIdx}` ? "생성 중…" : "🎙 음성 전체 다시"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </Card>
          <div className="flex flex-wrap gap-2">
            <button className="btn-ghost" onClick={() => setTab("info")}>← ① 업체 정보</button>
            <button className="btn-primary ml-auto" onClick={() => setTab("preview")}>다음 단계 → ③ 미리보기 · 발행</button>
          </div>
        </div>
      )}

      {/* ── ③ 미리보기 · 발행 ────────────────────────────── */}
      {tab === "preview" && (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)] gap-5 items-start">
          <div className="space-y-4">
            <Card title="🎞 미리보기">
              {dirty && (
                <p className="mb-3 rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900">
                  저장하지 않은 장면 수정이 있습니다. 이 영상은 예전 내용입니다 —
                  [② 장면 편집] 에서 <b>저장하고 영상 제작하기</b> 를 눌러 주세요.
                </p>
              )}
              {videoUrl ? (
                <video key={videoUrl + (reel.duration_sec ?? 0)} src={videoUrl} controls playsInline className="w-full rounded-xl bg-black aspect-9/16" />
              ) : (
                <div className="aspect-9/16 rounded-xl bg-gray-100 flex flex-col items-center justify-center gap-3 p-6 text-center">
                  <div className="text-lg font-extrabold text-gray-800">영상이 아직 없습니다</div>
                  <p className="text-sm text-gray-700 leading-relaxed">
                    {reel.status === "발행완료" || reel.status === "예약"
                      ? "발행 기록은 있는데 영상 파일이 없습니다. 예전에 만들다 만 릴스일 수 있습니다."
                      : "대본은 있지만 영상이 아직 만들어지지 않았습니다."}
                  </p>
                  <button className="btn-primary" onClick={() => setTab("scenes")}>
                    ② 장면 편집에서 [저장하고 영상 제작하기]
                  </button>
                  {lastPublishError && (
                    <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 break-words">
                      마지막 오류: {lastPublishError}
                    </p>
                  )}
                </div>
              )}
              {quality.voice_notice && (
                <p className="mt-3 rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900 break-words">
                  ⚠ AI 음성이 생성되지 않아 <b>무음</b>으로 만들어졌습니다 — {quality.voice_notice}
                </p>
              )}
              {reel.video_path && (
                <button className="btn-primary w-full mt-4" onClick={() => router.push(`/review/${id}`)}>
                  🔎 완성 콘텐츠 미리보기 · 검수
                </button>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-4">
                <button className="btn-primary col-span-full" disabled={!!busy || !reel.video_path}
                  onClick={() => setSchedOpen(true)}>
                  📅 예약 발행
                </button>
                <button className="btn-secondary" disabled={!!busy || !reel.video_path}
                  onClick={() => setConfirmPublish(true)}>
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
                      <span className="text-gray-600">{s.publish_at.replace("T", " ").slice(0, 16)}</span>
                      <StatusBadge status={s.status} />
                    </div>
                  ))}
                </div>
              )}
              {data.posts.map((p) => (
                <a key={p.ig_media_id} href={p.permalink ?? "#"} target="_blank" className="block mt-2 text-sm font-bold text-[#B84A1B]">
                  ↗ Instagram에서 보기
                </a>
              ))}
              {data.publishingJobs.filter((jb) => jb.phase === "실패").slice(0, 1).map((jb) => (
                <div key={jb.id} className="mt-3">
                  <ErrorBox msg={`발행 실패: ${jb.last_error ?? "알 수 없는 오류"}`} />
                  {jb.updated_at && (
                    <p className="text-xs text-gray-600 mt-1">
                      {jb.updated_at.slice(0, 16).replace("T", " ")} 에 난 오류입니다 — 지금 상태가 아닐 수 있습니다.
                    </p>
                  )}
                  <button className="btn-danger mt-2 w-full" disabled={!!busy}
                    onClick={() => run("retry", () => api(`/api/reels/${id}/retry`, { method: "POST", body: "{}" }), "재발행을 시작했습니다.")}>
                    ♻️ 재발행 시도
                  </button>
                </div>
              ))}
            </Card>

            <Card title="📱 휴대폰으로 직접 올리기">
              <ol className="text-sm text-gray-700 space-y-1 mb-3 list-decimal pl-5">
                <li>아래에서 영상 폴더를 열고 <b>reel.mp4</b> 를 휴대폰으로 옮깁니다</li>
                <li>Instagram 앱에서 릴스로 올립니다</li>
                <li>본문과 해시태그는 아래 단추로 복사해 붙여넣습니다</li>
              </ol>
              <div className="flex flex-wrap items-center gap-3">
                {canOpenFolder() && (
                  <button className="btn-primary" onClick={openFolder}>📁 영상 폴더 열기</button>
                )}
                <button className="btn-secondary" disabled={!caption}
                  onClick={() => copyAnd("본문", caption)}>📋 본문 복사</button>
                <button className="btn-secondary" disabled={!hashtags}
                  onClick={() => copyAnd("해시태그", hashtags)}>📋 해시태그 복사</button>
              </div>
              {reel.output_dir && (
                <p className="text-xs text-gray-600 mt-3 break-all">
                  저장 위치: <code className="bg-gray-100 px-1 rounded">{reel.output_dir}</code>
                </p>
              )}
            </Card>
          </div>

          <div className="space-y-4">
            {quality.image_notice && (
              <div className="card p-4 bg-amber-50 border-amber-300">
                <div className="font-extrabold text-amber-800 mb-1">🖼 임시 이미지가 포함되어 있습니다</div>
                <div className="text-sm text-amber-900">{quality.image_notice}</div>
              </div>
            )}
            <Card title="📝 Instagram 본문 · 해시태그">
              <label className="label text-sm">본문 (Caption)</label>
              <textarea className="input" rows={8} value={caption ?? ""} onChange={(e) => setCaption(e.target.value)} />
              <label className="label text-sm mt-3">해시태그 (공백으로 구분, 5~12개 권장)</label>
              <textarea className="input" rows={2} value={hashtags ?? ""} onChange={(e) => setHashtags(e.target.value)} />
              {captionDirty && (
                <button className="btn-primary mt-3" disabled={!!busy} onClick={saveEdits}>
                  {busy === "save" ? "저장하고 만드는 중…" : "💾 저장하고 영상 제작하기"}
                </button>
              )}
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
                <div className="text-lg font-extrabold text-[#B84A1B] mb-2">“{verdict.한줄판정}”</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-sm">
                  <div>가성비 <Stars n={verdict.가성비 ?? 0} /></div>
                  <div>맛 <Stars n={verdict.맛 ?? 0} /></div>
                  <div>양 <Stars n={verdict.양 ?? 0} /></div>
                  <div>재방문 <Stars n={verdict.재방문 ?? 0} /></div>
                </div>
                <p className="text-xs text-gray-600 mt-2">* 오락푸드 자체 콘텐츠 평가입니다 (실사용자 리뷰 아님)</p>
              </Card>
            )}
          </div>
        </div>
      )}

      {schedOpen && (
        <ScheduleDialog
          reelId={id}
          onClose={() => setSchedOpen(false)}
          onScheduled={(at) => {
            setSchedOpen(false);
            setMsg(`${at.replace("T", " ")} 에 예약했습니다. 그 시각에 프로그램이 켜져 있어야 합니다.`);
            reload();
          }}
        />
      )}

      {confirmPublish && (
        <PublishDialog
          reelId={id}
          videoPath={reel.video_path}
          onClose={() => setConfirmPublish(false)}
          onPublished={() => {
            setConfirmPublish(false);
            setMsg("발행을 시작했습니다. 발행 상태에서 진행을 확인하세요.");
            reload();
          }}
        />
      )}
    </div>
  );
}
