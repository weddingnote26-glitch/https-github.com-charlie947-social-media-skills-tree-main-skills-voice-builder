"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, ProgressBar, ErrorBox, StepRow, api } from "@/components/ui";
import { jobProgress, type ProgressStep } from "@/lib/pipeline/progress";
import { useToast } from "@/components/Toast";
import RestaurantPicker from "@/components/RestaurantPicker";

const AREAS = ["관악구", "신림", "봉천", "서울대입구", "낙성대", "기타 서울"];
const TYPES = ["자동 추천", "가성비 맛집", "숨은 동네 맛집", "부모님과 가기 좋은 곳", "5070 추천 맛집", "혼밥 맛집", "데이트 맛집", "친구 모임 맛집", "메뉴 하나 집중 소개", "가격 대비 만족도", "오래된 동네 맛집", "반전 맛집", "직접 가보고 싶은 맛집"];

interface Job {
  id: string; reel_id: string | null; status: string; error: string | null;
  steps: ProgressStep[];
}

export default function Today() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [area, setArea] = useState("관악구");
  const [type, setType] = useState("자동 추천");
  const [mode, setMode] = useState<"ORAKI_DETECTIVE" | "NORMAL_FOOD">("ORAKI_DETECTIVE");
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [err, setErr] = useState<string | null>(null);
  /** 맛집 DB 에서 고른 업체 — 있으면 조사 없이 그 업체(수기 입력 포함)를 그대로 쓴다 */
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);
  const [picking, setPicking] = useState(false);
  const [similar, setSimilar] = useState<Array<{ id: string; name: string; area: string }>>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const toast = useToast();
  // 같은 작업에 대해 알림을 한 번만 띄우기 위한 표시
  const notified = useRef<string | null>(null);

  const start = async () => {
    setErr(null);
    try {
      const { jobId } = await api<{ jobId: string }>("/api/produce", {
        method: "POST",
        body: JSON.stringify({
          restaurantId: picked?.id,
          restaurantName: picked ? undefined : (name || undefined),
          restaurantUrl: picked ? undefined : (url || undefined),
          area, contentType: type, contentMode: mode,
        }),
      });
      setJobId(jobId);
      notified.current = null;
      toast.info("제작을 시작했습니다.", [`${picked?.name || name || url} · ${type}`]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      toast.fromError(e, "입력값을 확인하고 다시 시도해 주세요.");
    }
  };

  useEffect(() => {
    if (!jobId) return;
    const poll = async () => {
      try {
        const j = await api<Job>(`/api/produce/${jobId}`);
        setJob(j);
        if (j.status !== "진행중") {
          if (timer.current) clearInterval(timer.current);
          if (notified.current !== j.id) {
            notified.current = j.id;
            // 실패했을 때 성공 알림을 띄우지 않는다
            if (j.status === "완료") toast.success("릴스 제작이 완료되었습니다.", [j.reel_id ? "미리보기에서 확인할 수 있습니다." : ""].filter(Boolean));
            else toast.error(j.error ?? "제작에 실패했습니다.", "실패한 단계를 확인한 뒤 [다시 시도]를 눌러 주세요.");
          }
        }
      } catch { /* 다음 폴링에서 재시도 */ }
    };
    poll();
    timer.current = setInterval(poll, 1500);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [jobId]);

  const producing = job?.status === "진행중";
  const done = job?.status === "완료";

  return (
    <div className="page space-y-6">
      <header>
        <h1 className="text-2xl font-extrabold">✨ 오늘의 릴스 만들기</h1>
        <p className="text-gray-600 mt-1">맛집 이름이나 주소 하나만 넣으면, 나머지는 오락이가 조사합니다.</p>
      </header>

      {!jobId && (
        <Card>
          <div className="space-y-5">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="label mb-0">맛집명</label>
                <button type="button" className="btn-secondary" onClick={() => setPicking((v) => !v)}>
                  📇 맛집 DB에서 불러오기
                </button>
              </div>
              {picked ? (
                <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded-xl border-2 border-emerald-300 bg-emerald-50 p-3">
                  <span className="font-bold break-keep">✅ {picked.name}</span>
                  <span className="text-sm text-emerald-800">저장된 업체 정보(직접 입력 포함)를 그대로 씁니다.</span>
                  <button type="button" className="btn-ghost ml-auto" onClick={() => setPicked(null)}>선택 해제</button>
                </div>
              ) : (
                <input className="input mt-1.5" placeholder="예: 신림동 ○○식당" value={name}
                  onChange={(e) => { setName(e.target.value); setSimilar([]); }}
                  onBlur={() => {
                    const q = name.trim();
                    if (!q) return;
                    // 비슷한 이름이 이미 있으면 알려 준다 — 같은 가게가 또 생기지 않게
                    void api<{ list: Array<{ id: string; name: string; area: string }> }>(
                      `/api/restaurants?q=${encodeURIComponent(q)}`
                    ).then((r) => setSimilar(r.list.slice(0, 3))).catch(() => {});
                  }} />
              )}
              {!picked && similar.length > 0 && (
                <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <p className="text-sm font-bold text-amber-900 mb-2">혹시 이 가게인가요? 고르면 저장된 정보를 그대로 씁니다.</p>
                  <div className="flex flex-wrap gap-2">
                    {similar.map((r) => (
                      <button key={r.id} type="button" className="btn-secondary"
                        onClick={() => { setPicked({ id: r.id, name: r.name }); setSimilar([]); }}>
                        {r.name}{r.area ? ` (${r.area})` : ""}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {picking && (
                <RestaurantPicker
                  onClose={() => setPicking(false)}
                  onPick={(id, pickedName) => { setPicked({ id, name: pickedName }); setPicking(false); setSimilar([]); }}
                />
              )}
            </div>
            <div>
              <label className="label">맛집 URL <span className="font-normal text-gray-600">(선택 — Instagram / 지도 / 블로그)</span></label>
              <input className="input" placeholder="https://..." value={url} onChange={(e) => setUrl(e.target.value)} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">지역</label>
                <select className="input" value={area} onChange={(e) => setArea(e.target.value)}>
                  {AREAS.map((a) => <option key={a}>{a}</option>)}
                </select>
              </div>
              <div>
                <label className="label">콘텐츠 유형</label>
                <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
                  {TYPES.map((t) => <option key={t}>{t}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="label">영상 스타일</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button type="button" onClick={() => setMode("ORAKI_DETECTIVE")}
                  className={`rounded-xl border-2 p-4 text-left transition ${mode === "ORAKI_DETECTIVE" ? "border-[#E86A3A] bg-[#FDEDE5]" : "border-gray-200 hover:border-gray-300"}`}>
                  <div className="text-lg font-extrabold">🥟 만두탐정 오락이</div>
                  <div className="text-sm text-gray-600 mt-0.5">맛집 사건 파일 — 오락이가 조사하고 판정합니다</div>
                </button>
                <button type="button" onClick={() => setMode("NORMAL_FOOD")}
                  className={`rounded-xl border-2 p-4 text-left transition ${mode === "NORMAL_FOOD" ? "border-[#E86A3A] bg-[#FDEDE5]" : "border-gray-200 hover:border-gray-300"}`}>
                  <div className="text-lg font-extrabold">🍚 일반 맛집 영상</div>
                  <div className="text-sm text-gray-600 mt-0.5">음식 중심의 정보형 릴스</div>
                </button>
              </div>
            </div>
            <ErrorBox msg={err} />
            <button className="btn-primary w-full" onClick={start} disabled={!name.trim() && !url.trim()}>
              🚀 AI 자동제작 시작
            </button>
            <p className="text-xs text-gray-600 text-center">대본 → 팩트체크 → 이미지 → 음성 → 자막 → 영상 → 썸네일까지 자동으로 만듭니다. 발행 전 항상 미리보기로 확인할 수 있어요.</p>
          </div>
        </Card>
      )}

      {jobId && job && (
        <Card title={producing ? "🎬 제작 중입니다…" : done ? "✅ 제작 완료!" : "❌ 제작 실패"}>
          <div className="mb-4 flex items-center gap-3">
            <div className="flex-1">
              <ProgressBar pct={jobProgress(job.steps)} label="전체 진행률"
                tone={job.status === "실패" ? "bg-red-400" : job.status === "완료" ? "bg-emerald-500" : "bg-[#E86A3A]"} />
            </div>
            <span className="text-lg font-extrabold tabular-nums w-14 text-right">{jobProgress(job.steps)}%</span>
          </div>
          <div className="space-y-3">
            {job.steps.map((s) => <StepRow key={s.key} step={s} />)}
          </div>
          {job.error && <div className="mt-4"><ErrorBox msg={job.error} /></div>}
          <div className="flex gap-3 mt-6">
            {done && job.reel_id && (
              <button className="btn-primary flex-1" onClick={() => router.push(`/reel/${job.reel_id}`)}>
                🎞 미리보기 · 검수하러 가기
              </button>
            )}
            {!producing && (
              <button className="btn-secondary" onClick={() => { setJobId(null); setJob(null); }}>
                {done ? "새로 만들기" : "다시 시도"}
              </button>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
