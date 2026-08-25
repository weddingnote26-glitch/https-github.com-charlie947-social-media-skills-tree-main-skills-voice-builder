"use client";
import { useState } from "react";
import Link from "next/link";
import { Card, StatusBadge, api, useApi, ErrorBox } from "@/components/ui";

interface CalData {
  month: string;
  reels: Array<{ id: string; title: string; status: string; planned_date: string; content_mode: string; case_number: number | null }>;
  schedules: Array<{ reel_id: string; publish_at: string; status: string }>;
}

export default function CalendarPage() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const { data, reload } = useApi<CalData>(`/api/calendar?month=${month}`, 8000);
  const [err, setErr] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  const first = new Date(month + "-01T00:00:00");
  const startPad = (first.getDay() + 6) % 7; // 월요일 시작
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const cells: Array<string | null> = [
    ...Array.from({ length: startPad }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`),
  ];

  const shift = (delta: number) => {
    const d = new Date(first);
    d.setMonth(d.getMonth() + delta);
    setMonth(d.toISOString().slice(0, 7));
  };

  const drop = async (date: string) => {
    if (!dragId) return;
    try { await api("/api/calendar", { method: "PATCH", body: JSON.stringify({ reelId: dragId, date }) }); reload(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setDragId(null);
  };

  return (
    <div className="page space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold">📅 콘텐츠 캘린더</h1>
        <div className="flex items-center gap-3">
          <button className="btn-ghost" onClick={() => shift(-1)}>← 이전 달</button>
          <span className="text-lg font-extrabold">{month}</span>
          <button className="btn-ghost" onClick={() => shift(1)}>다음 달 →</button>
        </div>
      </header>
      <ErrorBox msg={err} />
      <p className="text-sm text-gray-600">카드를 끌어서 다른 날짜에 놓으면 일정이 이동합니다. 예약 시각도 같이 이동합니다.</p>

      <Card>
        {/* 달력은 7칸이 요일을 뜻하므로 접지 않는다. 좁은 화면에서는 이 부분만 옆으로 넘긴다. */}
        <div className="scroll-x-sm">
        <div className="min-w-[38rem]">
        <div className="grid grid-cols-7 gap-2 text-center text-sm font-extrabold text-gray-700 mb-2">
          {["월", "화", "수", "목", "금", "토", "일"].map((d) => <div key={d}>{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-2">
          {cells.map((date, i) => (
            <div key={i}
              onDragOver={(e) => date && e.preventDefault()}
              onDrop={() => date && drop(date)}
              className={`min-h-28 rounded-xl border p-2 ${date ? "border-gray-200 bg-white" : "border-transparent"} ${dragId && date ? "border-dashed border-[#E86A3A]" : ""}`}>
              {date && <div className="text-xs font-bold text-gray-600 mb-1">{parseInt(date.slice(8))}</div>}
              {date && (data?.reels ?? []).filter((r) => r.planned_date === date).map((r) => {
                const sch = (data?.schedules ?? []).find((s) => s.reel_id === r.id);
                return (
                  <div key={r.id} draggable onDragStart={() => setDragId(r.id)}
                    className="mb-1 rounded-lg border border-gray-200 bg-white p-1.5 cursor-grab shadow-sm hover:shadow">
                    <Link href={`/reel/${r.id}`} className="block">
                      <div className="flex items-center gap-1">
                        <span>{r.content_mode === "ORAKI_DETECTIVE" ? "🥟" : "🍚"}</span>
                        <StatusBadge status={r.status} />
                      </div>
                      <div className="text-xs font-bold truncate mt-0.5">{r.title || "제목 없음"}</div>
                      {sch && <div className="text-xs text-gray-600">{sch.publish_at.slice(11, 16)} 발행</div>}
                    </Link>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        </div>
        </div>
      </Card>
    </div>
  );
}
