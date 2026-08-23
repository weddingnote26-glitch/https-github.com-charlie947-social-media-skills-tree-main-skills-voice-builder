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
    <div className="max-w-4xl space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-extrabold">🗓 이번 주 릴스 6개</h1>
          <p className="text-gray-500 mt-1">월~토 기획안을 먼저 확인하고, 전체 승인하면 순서대로 제작합니다.</p>
        </div>
        <button className="btn-secondary" onClick={gen} disabled={busy}>♻️ 기획안 새로 만들기</button>
      </header>
      <ErrorBox msg={err} />

      {!shown && (
        <Card>
          <div className="text-center py-14">
            <div className="text-5xl mb-4">🥟</div>
            <p className="text-gray-500 mb-6">아직 이번 주 기획안이 없습니다.</p>
            <button className="btn-primary" onClick={gen} disabled={busy}>✨ 이번 주 릴스 6개 만들기</button>
          </div>
        </Card>
      )}

      {shown && (
        <Card title={`${data?.weekStart} 주간 기획안`} right={plan && <StatusBadge status={plan.status} />}>
          <div className="space-y-3">
            {shown.map((it, i) => (
              <div key={it.date} className="flex items-center gap-4 rounded-xl border border-gray-200 p-3">
                <div className="w-14 text-center">
                  <div className="text-lg font-extrabold">{it.weekday}</div>
                  <div className="text-xs text-gray-400">{it.date.slice(5)}</div>
                </div>
                <div className="flex-1 grid grid-cols-3 gap-2">
                  <div>
                    <div className="text-xs text-gray-400 font-bold">지역</div>
                    <div className="font-bold">{it.area}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-400 font-bold">유형</div>
                    <div className="font-bold">{it.content_type}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-400 font-bold">스타일</div>
                    <div className="font-bold">{it.content_mode === "ORAKI_DETECTIVE" ? "🥟 오락이 탐정" : "🍚 일반"}</div>
                  </div>
                </div>
                <input className="input w-56 py-2 text-sm" placeholder="맛집명(비우면 유형으로 샘플 기획)"
                  value={it.restaurant_hint}
                  onChange={(e) => {
                    const next = [...shown]; next[i] = { ...it, restaurant_hint: e.target.value }; setItems(next);
                  }} />
                {it.reel_id
                  ? <Link href={`/reel/${it.reel_id}`} className="btn-ghost">보기 →</Link>
                  : <StatusBadge status={it.status} />}
              </div>
            ))}
          </div>
          {plan && plan.status === "기획" && (
            <button className="btn-primary w-full mt-5 py-4 text-lg" onClick={approve} disabled={busy}>
              ✅ 전체 승인 — 순서대로 제작 시작
            </button>
          )}
          {plan?.status === "제작중" && <p className="text-center text-sm font-bold text-blue-600 mt-4">순차 제작이 진행 중입니다 — 제작중 메뉴에서 확인하세요.</p>}
        </Card>
      )}
    </div>
  );
}
