"use client";
import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, StatusBadge, Stars, ErrorBox, api, mediaUrl, useApi, canOpenFolder, openOutputFolder, copyText } from "@/components/ui";
import RestaurantForm, { FieldStatusBadge, type FormValue } from "@/components/RestaurantForm";
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
  if (!data || !scenes) return <div className="text-gray-600 py-20 text-center">불러오는 중…</div>;
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
  // 영상이 없을 때 "왜 없는지" 를 함께 보여주기 위해 마지막 발행 오류를 찾아 둔다
  const lastPublishError = data.publishingJobs.find((jb) => jb.phase === "실패")?.last_error ?? null;

  const run = async (label: string, fn: () => Promise<unknown>, doneMsg: string) => {
    setBusy(label); setErr(null); setMsg(null);
    try { await fn(); setMsg(doneMsg); setScenes(null); reload(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  /**
   * 저장과 영상 제작은 별개의 단계다.
   * 한꺼번에 실패로 뭉뚱그리면 "내가 고친 게 날아갔나?" 를 알 수 없다.
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
      setMsg("수정 내용을 저장하고 영상을 만들었습니다. 아래 미리보기에서 확인해 주세요.");
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
  };

  return (
    <div className="page space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <StatusBadge status={reel.status} />
            {reel.case_number && <span className="badge bg-[#FDEDE5] text-[#B84A1B]">맛집사건 #{String(reel.case_number).padStart(3, "0")}</span>}
            <span className="badge bg-gray-100 text-gray-600">{reel.content_type}</span>
          </div>
          <h1 className="text-2xl font-extrabold mt-2">{reel.title || "제목 없음"}</h1>
          <p className="text-gray-600 text-sm mt-1">{reel.planned_date} · {reel.duration_sec ? `${reel.duration_sec.toFixed(1)}초` : "영상 없음"} · {reel.content_mode === "ORAKI_DETECTIVE" ? "🥟 만두탐정 오락이" : "🍚 일반 맛집"}</p>
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

      {/* 왼쪽을 420px 로 못 박아 두니 화면이 좁을 때 오른쪽 장면 편집 칸이
          350px 까지 눌려 글자·알약이 죄다 쪼개졌다.
          · 넓을 때만 두 칸으로 나누고
          · minmax(0,…) 로 두 칸 모두 줄어들 수 있게 한다 (1fr 만 쓰면 안 줄어든다) */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)] gap-6">
        {/* 미리보기 */}
        <div className="space-y-4">
          <Card title="🎞 미리보기">
            {videoUrl ? (
              <video key={videoUrl + (reel.duration_sec ?? 0)} src={videoUrl} controls playsInline className="w-full rounded-xl bg-black aspect-9/16" />
            ) : (
              <div className="aspect-9/16 rounded-xl bg-gray-100 flex flex-col items-center justify-center gap-3 p-6 text-center">
                <div className="text-lg font-extrabold text-gray-800">영상이 아직 없습니다</div>
                <p className="text-sm text-gray-700 leading-relaxed">
                  {reel.status === "발행완료" || reel.status === "예약"
                    ? "발행 기록은 있는데 영상 파일이 없습니다. 예전에 만들다 만 릴스일 수 있습니다."
                    : "대본은 있지만 영상이 아직 만들어지지 않았습니다."}
                  <br />아래 [저장하고 영상 제작하기]를 누르면 지금 있는 대본·음성·이미지로 영상을 만듭니다.
                </p>
                {lastPublishError && (
                  <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 break-words">
                    마지막 오류: {lastPublishError}
                  </p>
                )}
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-4">
              <button className="btn-primary col-span-full" disabled={!!busy || !reel.video_path || quality.fact_blocked}
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

          {/* Instagram 자동 발행은 영상 공개 주소가 있어야 한다.
              그 전까지는 휴대폰으로 옮겨 직접 올리는 편이 빠르다 — 그 길을 막지 않는다. */}
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
              <div className="mt-3">
                <p className="text-xs text-gray-600 mb-2">
                  ⚠ 확인 필요 항목은 직접 적어 넣으면 확인된 정보로 바뀝니다.
                </p>
                <button className="btn-secondary w-full" onClick={() => {
                  document.getElementById("업체정보")?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}>✏️ 업체 정보 직접 입력하기</button>
              </div>
            )}
          </Card>
        </div>

        {/* 편집 (§46) */}
        <div className="space-y-4">
          <Card title="🎬 장면 편집" right={
            <div className="flex flex-wrap items-center gap-3">
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
            <div className="space-y-3">
              {scenes.map((s, i) => (
                <div key={s.scene + "-" + i} className="rounded-xl border border-gray-200 p-3">
                  {/* 좁아지면 눌러 찌그러뜨리지 말고 줄을 넘긴다.
                      장면 이동·삭제 단추는 항상 오른쪽 끝에 같은 크기로 붙어 있어야 한다. */}
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span className="badge bg-gray-800 text-white">SCENE {i + 1}</span>
                    <span className="text-xs text-gray-600 tabular-nums whitespace-nowrap shrink-0">{s.start}s ~ {s.end}s</span>
                    {s.character_action && (
                      <span className="badge badge-wrap max-w-full bg-[#FDEDE5] text-[#B84A1B]">🥟 {s.character_action}</span>
                    )}
                    <div className="ml-auto flex items-center gap-1 shrink-0">
                      <button className="btn-icon" onClick={() => move(i, -1)} title="위로" aria-label={`SCENE ${i + 1} 위로 옮기기`}>↑</button>
                      <button className="btn-icon" onClick={() => move(i, 1)} title="아래로" aria-label={`SCENE ${i + 1} 아래로 옮기기`}>↓</button>
                      <button className="btn-icon text-red-600 hover:bg-red-50" onClick={() => setScenes(scenes.filter((_, x) => x !== i))} title="장면 삭제" aria-label={`SCENE ${i + 1} 삭제`}>🗑</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-[96px_1fr] gap-3">
                    {mediaUrl(s.image_path) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={mediaUrl(s.image_path)!} alt="" className="w-24 aspect-9/16 object-cover rounded-lg border" />
                    ) : <div className="w-24 aspect-9/16 bg-gray-100 rounded-lg" />}
                    <div className="space-y-2">
                      <div>
                        <span className="text-xs font-bold text-gray-600">나레이션</span>
                        <textarea className="input" rows={2} value={s.narration}
                          onChange={(e) => setScenes(scenes.map((x, xi) => xi === i ? { ...x, narration: e.target.value } : x))} />
                      </div>
                      <div>
                        <span className="text-xs font-bold text-gray-600">자막 (한 줄 8~15자, 최대 2줄)</span>
                        <textarea className="input" rows={2} value={s.subtitle}
                          onChange={(e) => setScenes(scenes.map((x, xi) => xi === i ? { ...x, subtitle: e.target.value } : x))} />
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <label className="text-xs font-bold text-gray-600">길이(초)</label>
                        <input type="number" step="0.5" min="1.2" className="input w-full sm:w-24 min-w-0" value={(s.end - s.start).toFixed(1)}
                          onChange={(e) => {
                            const len = Math.max(1.2, parseFloat(e.target.value) || 2);
                            setScenes(scenes.map((x, xi) => xi === i ? { ...x, end: x.start + len } : x));
                          }} />
                        <button className="btn-ghost" disabled={!!busy}
                          onClick={() => run(`img${i}`, () => api(`/api/reels/${id}/regenerate`, { method: "POST", body: JSON.stringify({ scene: s.scene, what: "image" }) }), `SCENE ${i + 1} 이미지를 다시 만들었습니다. 저장하면 영상에 반영됩니다.`)}>
                          {busy === `img${i}` ? "생성 중…" : "🖼 이미지만 다시"}
                        </button>
                        <button className="btn-ghost" disabled={!!busy}
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
            <textarea className="input" rows={8} value={caption ?? ""} onChange={(e) => setCaption(e.target.value)} />
            <label className="label text-sm mt-3">해시태그 (공백으로 구분, 5~12개 권장)</label>
            <textarea className="input" rows={2} value={hashtags ?? ""} onChange={(e) => setHashtags(e.target.value)} />
          </Card>
        </div>
      </div>

      {/* §6 자동 수집이 막힌 정보를 사람이 적어 넣는 곳 — 칸이 12개라 폭을 다 쓴다 */}
      <div id="업체정보" className="scroll-mt-4">
        {/* 장면(scenes)은 건드리지 않는다 — null 로 되돌리면 화면 전체가 "불러오는 중…" 으로
            돌아가면서 방금 저장했다는 안내와 스크롤 위치가 사라진다 */}
        <RestaurantForm value={data.restaurant} onSaved={() => reload()} />
      </div>
    </div>
  );
}
