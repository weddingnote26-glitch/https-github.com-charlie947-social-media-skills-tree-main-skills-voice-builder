"use client";
import { useState } from "react";
import Link from "next/link";
import { Card, StatusBadge, useApi, mediaUrl } from "@/components/ui";

interface Reel { id: string; title: string; status: string; planned_date: string; thumb_path: string | null; content_mode: string; case_number: number | null; duration_sec: number | null }

const FILTERS = ["전체", "검수", "승인", "예약", "발행완료", "실패"];

export default function Library() {
  const [filter, setFilter] = useState("전체");
  const { data } = useApi<{ reels: Reel[] }>(`/api/reels${filter === "전체" ? "" : `?status=${encodeURIComponent(filter)}`}`, 6000);
  return (
    <div className="page space-y-6">
      <h1 className="text-2xl font-extrabold">✅ 완성 콘텐츠</h1>
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button key={f} onClick={() => setFilter(f)} className="chip" aria-pressed={filter === f}>
            {f}
          </button>
        ))}
      </div>
      <Card>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {(data?.reels ?? []).map((r) => (
            <Link key={r.id} href={`/reel/${r.id}`} className="rounded-xl border border-gray-200 overflow-hidden hover:shadow-md transition">
              {mediaUrl(r.thumb_path) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={mediaUrl(r.thumb_path)!} alt="" className="aspect-9/16 w-full object-cover" />
              ) : <div className="aspect-9/16 bg-gray-100 flex items-center justify-center text-3xl">{r.content_mode === "ORAKI_DETECTIVE" ? "🥟" : "🍚"}</div>}
              <div className="p-2.5">
                <div className="flex items-center gap-1"><StatusBadge status={r.status} />{r.case_number && <span className="text-xs font-bold text-[#B84A1B]">#{String(r.case_number).padStart(3, "0")}</span>}</div>
                <div className="text-sm font-bold truncate mt-1">{r.title || "제목 없음"}</div>
                <div className="text-xs text-gray-600">{r.planned_date} · {r.duration_sec ? `${Math.round(r.duration_sec)}초` : "-"}</div>
              </div>
            </Link>
          ))}
          {(data?.reels?.length ?? 0) === 0 && <div className="col-span-full text-center text-gray-600 py-14">해당 상태의 콘텐츠가 없습니다.</div>}
        </div>
      </Card>
    </div>
  );
}
