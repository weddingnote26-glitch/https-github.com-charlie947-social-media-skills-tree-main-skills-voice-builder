"use client";
import Link from "next/link";
import { Card, LoadGate, StatusBadge, useApi } from "@/components/ui";

interface Reel {
  id: string; title: string; status: string; video_path: string | null;
  planned_date: string | null; review_json: string; updated_at: string;
}

/**
 * §5 완성 콘텐츠 미리보기 — 검수를 기다리는 릴스 목록.
 * 발행 전에 반드시 이 화면을 거치게 한다.
 */
export default function ReviewListPage() {
  const { data, error, reload } = useApi<{ reels: Reel[] }>("/api/reels", 5000);
  if (!data) return <LoadGate error={error} onRetry={reload} what="완성 콘텐츠 목록" />;

  const withVideo = data.reels.filter((r) => r.video_path);
  const count = (r: Reel) => {
    try {
      const checks = (JSON.parse(r.review_json || "{}") as { checks?: Record<string, boolean> }).checks ?? {};
      return Object.values(checks).filter(Boolean).length;
    } catch { return 0; }
  };

  return (
    <div className="page space-y-6">
      <h1 className="text-2xl font-extrabold">🔎 미리보기 · 검수</h1>
      <p className="text-gray-700 -mt-2">
        발행하기 전에 영상·게시문·업체 정보를 눈으로 확인하는 곳입니다. 다섯 항목을 모두 확인해야 발행할 수 있습니다.
      </p>

      <Card>
        {withVideo.length === 0 ? (
          <div className="text-center text-gray-600 py-12">
            아직 완성된 영상이 없습니다. [오늘의 릴스]에서 먼저 만들어 주세요.
          </div>
        ) : (
          <div className="space-y-2">
            {withVideo.map((r) => {
              const done = count(r);
              return (
                <Link key={r.id} href={`/review/${r.id}`}
                  className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-gray-200 p-3 hover:border-[#E86A3A] transition">
                  <StatusBadge status={r.status} />
                  <span className="font-bold min-w-0 break-keep flex-1">{r.title || "(제목 없음)"}</span>
                  <span className={`badge ${done === 5 ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>
                    검수 {done}/5
                  </span>
                  {r.planned_date && <span className="text-sm text-gray-600 whitespace-nowrap">{r.planned_date}</span>}
                </Link>
              );
            })}
          </div>
        )}
        <button className="btn-ghost mt-3" onClick={reload}>새로고침</button>
      </Card>
    </div>
  );
}
