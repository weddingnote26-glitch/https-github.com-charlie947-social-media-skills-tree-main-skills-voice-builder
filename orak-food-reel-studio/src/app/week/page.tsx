"use client";
import { useState } from "react";
import Link from "next/link";
import { Card, StatusBadge, ErrorBox, api, useApi } from "@/components/ui";

interface Item {
  date: string; weekday: string; content_type: string; content_mode: string;
  area: string; restaurant_hint: string; reel_id?: string | null; status: string;
}
interface WeekData { weekStart: string; plan: { id: string; status: string; items: Item[] } | null }

export default function WeekPage() {
  const { data, reload } = useApi<WeekData>("/api/week", 5000);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<Item[] | null>(null);

  const plan = data?.plan ?? null;
  const shown = items ?? plan?.items ?? null;

  const gen = async () => {
    setBusy(true); setErr(null);
    try { await api("/api/week", { method: "POST", body: JSON.stringify({ action: "generate" }) }); setItems(null); reload(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const approve = async () => {
    if (!plan) return;
    setBusy(true); setErr(null);
    try {
      await api("/api/week", { method: "POST", body: JSON.stringify({ action: "approve", planId: plan.id, items: shown }) });
      setItems(null); reload();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="page space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">🗓 이번 주 릴스 6개</h1>
          <p className="text-gray-600 mt-1">월~토 기획안을 먼저 확인하고, 전체 승인하면 순서대로 제작합니다.</p>
        </div>
        <button className="btn-secondary" onClick={gen} disabled={busy}>♻️ 기획안 새로 만들기</button>
      </header>
      <ErrorBox msg={err} />

      {!shown && (
        <Card>
          <div className="text-center py-14">
            <div className="text-5xl mb-4">🥟</div>
            <p className="text-gray-600 mb-6">아직 이번 주 기획안이 없습니다.</p>
            <button className="btn-primary" onClick={gen} disabled={busy}>✨ 이번 주 릴스 6개 만들기</button>
          </div>
        </Card>
      )}

      {shown && (
        <Card title={`${data?.weekStart} 주간 기획안`} right={plan && <StatusBadge status={plan.status} />}>
          <div className="space-y-3">
            {shown.map((it, i) => (
              /* 하루가 한 덩어리로 읽히게: 날짜 → 기획 내용 → 상태 → 맛집명 입력 */
              <div key={it.date} className="rounded-xl border border-gray-200 p-4">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <div className="w-16 shrink-0">
                    <div className="text-lg font-extrabold">{it.weekday}</div>
                    <div className="text-xs text-gray-600">{it.date.slice(5)}</div>
                  </div>
                  {/* 값이 길어도 줄로 넘어갈 뿐 칸이 좁아지지 않는다 */}
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-1 flex-1 min-w-0">
                    <span><span className="text-xs text-gray-600 font-bold">지역 </span><span className="font-bold">{it.area}</span></span>
                    <span><span className="text-xs text-gray-600 font-bold">유형 </span><span className="font-bold">{it.content_type}</span></span>
                    <span><span className="text-xs text-gray-600 font-bold">스타일 </span><span className="font-bold">{it.content_mode === "ORAKI_DETECTIVE" ? "🥟 오락이 탐정" : "🍚 일반"}</span></span>
                  </div>
                  <div className="shrink-0">
                    {it.reel_id
                      ? <Link href={`/reel/${it.reel_id}`} className="btn-ghost">보기 →</Link>
                      : <StatusBadge status={it.status} />}
                  </div>
                </div>
                <label className="block mt-3">
                  <span className="sr-only">{it.weekday}요일 맛집명</span>
                  <input className="input" placeholder="맛집명 — 비우면 유형에 맞춰 샘플로 기획합니다"
                    value={it.restaurant_hint}
                    onChange={(e) => {
                      const next = [...shown]; next[i] = { ...it, restaurant_hint: e.target.value }; setItems(next);
                    }} />
                </label>
              </div>
            ))}
          </div>
          {plan && plan.status === "기획" && (
            <button className="btn-primary w-full mt-5" onClick={approve} disabled={busy}>
              ✅ 전체 승인 — 순서대로 제작 시작
            </button>
          )}
          {plan?.status === "제작중" && <p className="text-center text-sm font-bold text-blue-600 mt-4">순차 제작이 진행 중입니다 — 제작중 메뉴에서 확인하세요.</p>}
        </Card>
      )}
    </div>
  );
}
