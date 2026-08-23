"use client";
import Link from "next/link";
import { Card, ProgressBar, StatusBadge, useApi } from "@/components/ui";

interface Dash { producing: Array<{ id: string; reel_id: string | null; steps_json: string; status: string; updated_at: string }> }

export default function Producing() {
  const { data } = useApi<Dash>("/api/dashboard", 2500);
  const jobs = data?.producing ?? [];
  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-extrabold">🎬 제작중</h1>
      {jobs.length === 0 && (
        <Card><div className="text-center text-gray-400 py-14">지금 제작 중인 작업이 없습니다.<br /><Link href="/today" className="text-[#E86A3A] font-bold">✨ 오늘의 릴스 만들기 →</Link></div></Card>
      )}
      {jobs.map((p) => {
        const steps = JSON.parse(p.steps_json) as Array<{ key: string; label: string; status: string; progress: number; message?: string }>;
        return (
          <Card key={p.id} title={`작업 ${p.id.slice(-6)}`} right={<StatusBadge status={p.status} />}>
            <div className="space-y-2.5">
              {steps.map((s) => (
                <div key={s.key}>
                  <div className="flex justify-between text-sm font-bold mb-1">
                    <span>{s.status === "완료" ? "✓" : s.status === "진행중" ? "▶" : "·"} {s.label}</span>
                    <span className="text-gray-400 font-normal">{s.message ?? (s.status === "대기중" ? "대기중" : `${s.progress}%`)}</span>
                  </div>
                  <ProgressBar pct={s.status === "완료" ? 100 : s.progress} />
                </div>
              ))}
            </div>
            {p.reel_id && <Link href={`/reel/${p.reel_id}`} className="btn-secondary mt-4 w-full">결과 보기 →</Link>}
          </Card>
        );
      })}
    </div>
  );
}
