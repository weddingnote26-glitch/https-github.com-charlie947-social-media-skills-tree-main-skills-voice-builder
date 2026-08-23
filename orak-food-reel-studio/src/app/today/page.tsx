"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, ProgressBar, ErrorBox, api } from "@/components/ui";

const AREAS = ["관악구", "신림", "봉천", "서울대입구", "낙성대", "기타 서울"];
const TYPES = ["자동 추천", "가성비 맛집", "숨은 동네 맛집", "부모님과 가기 좋은 곳", "5070 추천 맛집", "혼밥 맛집", "데이트 맛집", "친구 모임 맛집", "메뉴 하나 집중 소개", "가격 대비 만족도", "오래된 동네 맛집", "반전 맛집", "직접 가보고 싶은 맛집"];

interface Job {
  id: string; reel_id: string | null; status: string; error: string | null;
  steps: Array<{ key: string; label: string; status: string; progress: number; message?: string }>;
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
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const start = async () => {
    setErr(null);
    try {
      const { jobId } = await api<{ jobId: string }>("/api/produce", {
        method: "POST",
        body: JSON.stringify({
          restaurantName: name || undefined, restaurantUrl: url || undefined,
          area, contentType: type, contentMode: mode,
        }),
      });
      setJobId(jobId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    if (!jobId) return;
    const poll = async () => {
      try {
        const j = await api<Job>(`/api/produce/${jobId}`);
        setJob(j);
        if (j.status !== "진행중" && timer.current) clearInterval(timer.current);
      } catch { /* 다음 폴링에서 재시도 */ }
    };
    poll();
    timer.current = setInterval(poll, 1500);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [jobId]);

  const producing = job?.status === "진행중";
  const done = job?.status === "완료";

  return (
    <div className="max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-extrabold">✨ 오늘의 릴스 만들기</h1>
        <p className="text-gray-500 mt-1">맛집 이름이나 주소 하나만 넣으면, 나머지는 오락이가 조사합니다.</p>
      </header>

      {!jobId && (
        <Card>
          <div className="space-y-5">
            <div>
              <label className="label">맛집명</label>
              <input className="input" placeholder="예: 신림동 ○○식당" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="label">맛집 URL <span className="font-normal text-gray-400">(선택 — Instagram / 지도 / 블로그)</span></label>
              <input className="input" placeholder="https://..." value={url} onChange={(e) => setUrl(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-4">
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
              <div className="grid grid-cols-2 gap-3">
                <button type="button" onClick={() => setMode("ORAKI_DETECTIVE")}
                  className={`rounded-xl border-2 p-4 text-left transition ${mode === "ORAKI_DETECTIVE" ? "border-[#E86A3A] bg-[#FDEDE5]" : "border-gray-200 hover:border-gray-300"}`}>
                  <div className="text-lg font-extrabold">🥟 만두탐정 오락이</div>
                  <div className="text-sm text-gray-500 mt-0.5">맛집 사건 파일 — 오락이가 조사하고 판정합니다</div>
                </button>
                <button type="button" onClick={() => setMode("NORMAL_FOOD")}
                  className={`rounded-xl border-2 p-4 text-left transition ${mode === "NORMAL_FOOD" ? "border-[#E86A3A] bg-[#FDEDE5]" : "border-gray-200 hover:border-gray-300"}`}>
                  <div className="text-lg font-extrabold">🍚 일반 맛집 영상</div>
                  <div className="text-sm text-gray-500 mt-0.5">음식 중심의 정보형 릴스</div>
                </button>
              </div>
            </div>
            <ErrorBox msg={err} />
            <button className="btn-primary w-full text-xl py-4" onClick={start} disabled={!name.trim() && !url.trim()}>
              🚀 AI 자동제작 시작
            </button>
            <p className="text-xs text-gray-400 text-center">대본 → 팩트체크 → 이미지 → 음성 → 자막 → 영상 → 썸네일까지 자동으로 만듭니다. 발행 전 항상 미리보기로 확인할 수 있어요.</p>
          </div>
        </Card>
      )}

      {jobId && job && (
        <Card title={producing ? "🎬 제작 중입니다…" : done ? "✅ 제작 완료!" : "❌ 제작 실패"}>
          <div className="space-y-3">
            {job.steps.map((s) => (
              <div key={s.key}>
                <div className="flex justify-between text-sm font-bold mb-1">
                  <span>{s.status === "완료" ? "✓" : s.status === "진행중" ? "▶" : s.status === "실패" ? "✗" : "·"} {s.label}</span>
                  <span className="text-gray-500 font-normal">{s.message ?? (s.status === "대기중" ? "대기중" : `${s.progress}%`)}</span>
                </div>
                <ProgressBar pct={s.status === "완료" ? 100 : s.progress} tone={s.status === "실패" ? "bg-red-400" : "bg-[#E86A3A]"} />
              </div>
            ))}
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
