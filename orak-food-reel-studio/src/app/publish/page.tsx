"use client";
import Link from "next/link";
import { Card, StatusBadge, useApi } from "@/components/ui";
import ScheduleTable from "@/components/ScheduleTable";

interface Reel { id: string; title: string; status: string; planned_date: string }

export default function PublishPage() {
  const { data: published } = useApi<{ reels: Reel[] }>("/api/reels?status=발행완료", 10000);
  const { data: failed } = useApi<{ reels: Reel[] }>("/api/reels?status=실패", 10000);
  const { data: review } = useApi<{ reels: Reel[] }>("/api/reels?status=검수", 5000);

  const List = ({ reels, empty }: { reels?: Reel[]; empty: string }) => (
    <div className="space-y-2">
      {(reels ?? []).map((r) => (
        <Link key={r.id} href={`/reel/${r.id}`} className="flex items-center justify-between rounded-xl border border-gray-200 p-3 hover:border-[#E86A3A]">
          <span className="font-bold truncate">{r.title || "제목 없음"}</span>
          <span className="flex items-center gap-2 text-sm text-gray-600">{r.planned_date}<StatusBadge status={r.status} /></span>
        </Link>
      ))}
      {(reels?.length ?? 0) === 0 && <div className="text-gray-600 text-sm py-6 text-center">{empty}</div>}
    </div>
  );

  return (
    <div className="page space-y-6">
      <h1 className="text-2xl font-extrabold">🚀 예약/발행</h1>
      <p className="text-gray-600 text-sm -mt-3">발행은 Meta 공식 Instagram API로 진행됩니다. 30초마다 자동으로 대기열을 확인합니다.</p>
      <Card title="검수 대기 — 승인 후 예약하세요"><List reels={review?.reels} empty="검수 대기 콘텐츠가 없습니다." /></Card>
      <ScheduleTable />
      <Card title="✅ 발행 완료"><List reels={published?.reels} empty="발행된 콘텐츠가 없습니다." /></Card>
      <Card title="❌ 실패 — 영상은 지워지지 않으며 재발행할 수 있습니다"><List reels={failed?.reels} empty="실패한 콘텐츠가 없습니다." /></Card>
    </div>
  );
}
