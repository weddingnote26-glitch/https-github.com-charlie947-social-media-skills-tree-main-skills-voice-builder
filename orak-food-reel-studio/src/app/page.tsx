"use client";
import Link from "next/link";
import { Card, StatusBadge, ProgressBar, useApi, mediaUrl } from "@/components/ui";

interface Dash {
  today: { planned: number; done: number; scheduled: number; published: number; failed: number };
  week: { produced: number; published: number; scheduled: number; failed: number };
  producing: Array<{ id: string; reel_id: string | null; steps_json: string; status: string }>;
  recent: Array<{ id: string; title: string; status: string; planned_date: string; thumb_path: string | null; permalink: string | null }>;
  weekDays: Array<{ date: string; weekday: string; reels: Array<{ id: string; title: string; status: string }> }>;
}

export default function Home() {
  const { data, loading } = useApi<Dash>("/api/dashboard", 5000);
  const { data: health } = useApi<{ mode: string; builtAt: string | null; ffmpeg: { found: boolean }; services: Record<string, boolean>; settings: { wizardDone: boolean } }>("/api/health");

  return (
    <div className="page space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-extrabold">🏠 홈</h1>
          <p className="text-gray-600 mt-1">오늘도 맛있는 사건을 찾아 신림 골목을 조사합니다.</p>
        </div>
        <Link href="/today" className="btn-primary">✨ 오늘의 릴스 만들기</Link>
      </header>

      {health && !health.settings.wizardDone && (
        <Link href="/wizard" className="block card p-4 border-[#E86A3A] bg-[#FDEDE5] font-bold text-[#B84A1B]">
          👋 처음이신가요? 첫 실행 마법사에서 8단계 설정을 진행하세요 →
        </Link>
      )}
      {health?.mode === "sample" && (
        /* 설치형 앱에는 .env 파일이 없다 — 실행 모드는 설정 화면에서 바꾼다 */
        <div className="card p-3 px-4 text-sm text-amber-900 bg-amber-50 border-amber-200">
          🧪 지금은 <b>연습 모드</b>입니다 — API 키 없이 전체 제작 흐름을 시험할 수 있어요.
          실제로 만들려면 <Link href="/settings" className="font-bold underline text-[#B84A1B]">설정</Link>에서
          API 키를 넣고 맨 위 <b>⚡ 실행 모드</b>를 <b>실제 모드</b>로 바꾸세요.
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {[
          ["오늘 제작 예정", data?.today.planned],
          ["오늘 제작 완료", data?.today.done],
          ["오늘 예약 발행", data?.today.scheduled],
          ["업로드 성공", data?.today.published],
          ["실패", data?.today.failed],
        ].map(([label, v]) => (
          <Card key={label as string} className="text-center">
            <div className="text-3xl font-extrabold">{loading ? "–" : String(v ?? 0)}</div>
            <div className="text-sm text-gray-600 mt-1 font-semibold">{label}</div>
          </Card>
        ))}
      </div>

      <Card title="이번 주 (월~토)">
        <div className="grid grid-cols-3 lg:grid-cols-6 gap-3">
          {(data?.weekDays ?? []).map((d) => (
            <div key={d.date} className="rounded-xl border border-gray-200 p-3 min-h-24">
              <div className="text-sm font-extrabold mb-2">{d.weekday} <span className="text-gray-600 font-normal">{d.date.slice(5)}</span></div>
              {/* 빈 날은 흐린 동그라미 대신 읽을 수 있는 글자로 알린다 */}
              {d.reels.length === 0 && <div className="text-xs text-gray-600">아직 없음</div>}
              {d.reels.map((r) => (
                <Link key={r.id} href={`/reel/${r.id}`} className="block text-xs font-semibold truncate hover:text-[#B84A1B]">
                  <StatusBadge status={r.status} /> <span className="ml-1">{r.title || "제목 없음"}</span>
                </Link>
              ))}
            </div>
          ))}
        </div>
        <div className="flex gap-6 mt-4 text-sm text-gray-600 font-semibold">
          <span>이번 주 제작 {data?.week.produced ?? 0}</span>
          <span>게시 완료 {data?.week.published ?? 0}</span>
          <span>예약 {data?.week.scheduled ?? 0}</span>
          <span className={data?.week.failed ? "text-red-600" : ""}>실패 {data?.week.failed ?? 0}</span>
        </div>
      </Card>

      {(data?.producing?.length ?? 0) > 0 && (
        <Card title="🎬 지금 제작 중">
          {data!.producing.map((p) => {
            const steps = JSON.parse(p.steps_json) as Array<{ label: string; status: string; progress: number }>;
            const doneCount = steps.filter((s) => s.status === "완료").length;
            const cur = steps.find((s) => s.status === "진행중");
            return (
              <Link key={p.id} href="/producing" className="block mb-3">
                <div className="flex justify-between text-sm font-bold mb-1">
                  <span>{cur ? `${cur.label} 진행 중…` : "마무리 중"}</span>
                  <span>{doneCount}/{steps.length} 단계</span>
                </div>
                <ProgressBar pct={(doneCount / steps.length) * 100} />
              </Link>
            );
          })}
        </Card>
      )}

      {health?.builtAt && (
        <div className="text-xs text-gray-600 text-right -mb-2">
          실행 중인 버전 · {new Date(health.builtAt).toLocaleString("ko-KR")} 빌드
        </div>
      )}

      <Card title="최근 콘텐츠" right={<Link className="btn-ghost" href="/library">전체 보기 →</Link>}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {(data?.recent ?? []).map((r) => (
            <Link key={r.id} href={`/reel/${r.id}`} className="rounded-xl border border-gray-200 overflow-hidden hover:shadow-md transition">
              {mediaUrl(r.thumb_path) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={mediaUrl(r.thumb_path)!} alt="" className="aspect-9/16 w-full object-cover" />
              ) : (
                <div className="aspect-9/16 bg-gray-100 flex items-center justify-center text-3xl">🥟</div>
              )}
              <div className="p-2.5">
                <StatusBadge status={r.status} />
                <div className="text-sm font-bold truncate mt-1">{r.title || "제목 없음"}</div>
                <div className="text-xs text-gray-600">{r.planned_date}</div>
              </div>
            </Link>
          ))}
          {(data?.recent?.length ?? 0) === 0 && <div className="text-gray-600 col-span-full py-8 text-center">아직 만든 릴스가 없습니다. ✨ 오늘의 릴스에서 시작해보세요.</div>}
        </div>
      </Card>
    </div>
  );
}
