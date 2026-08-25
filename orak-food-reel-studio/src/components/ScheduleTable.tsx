"use client";
import { useState } from "react";
import Link from "next/link";
import { Card, StatusBadge, api, useApi } from "./ui";

interface Row {
  id: string; reel_id: string; publish_at: string; status: string;
  title: string; restaurant_name: string | null; video_path: string | null;
}
interface Data {
  schedules: Row[]; account: string; timezone: string; earliest: string;
  needsAppRunning: boolean; desktop: boolean;
}

/** §8 예약 목록 — 시각 수정 · 취소 · 지금 발행 · 미리보기 */
export default function ScheduleTable() {
  const { data, reload } = useApi<Data>("/api/schedules", 8000);
  const [editing, setEditing] = useState<string | null>(null);
  const [at, setAt] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const act = async (id: string, body: Record<string, unknown>, done: string) => {
    setBusy(id); setErr(null); setMsg(null);
    try {
      await api("/api/schedules", { method: "PATCH", body: JSON.stringify({ id, ...body }) });
      setMsg(done); setEditing(null); reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  };

  const waiting = (data?.schedules ?? []).filter((s) => s.status === "예약");
  const past = (data?.schedules ?? []).filter((s) => s.status !== "예약");

  return (
    <Card title="📅 예약 목록" right={<button className="btn-ghost" onClick={reload}>새로고침</button>}>
      {data && (
        <p className="text-sm text-gray-600 mb-3">
          올라갈 계정 <b>{data.account}</b> · 시간대 <b>{data.timezone}</b>
          <br />
          <span className="text-amber-800">
            ⚠ 예약 시각에 이 프로그램이 켜져 있어야 발행됩니다. 꺼져 있으면 다시 켰을 때 이어서 진행합니다.
          </span>
        </p>
      )}

      {err && <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-3 break-words">{err}</div>}
      {msg && <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-800 mb-3">{msg}</div>}

      {waiting.length === 0 && <div className="text-gray-600 text-sm py-6 text-center">예약된 콘텐츠가 없습니다.</div>}

      <div className="space-y-2">
        {waiting.map((s) => (
          <div key={s.id} className="rounded-xl border-2 border-gray-200 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-bold tabular-nums whitespace-nowrap">{s.publish_at.replace("T", " ").slice(0, 16)}</span>
              <StatusBadge status={s.status} />
              <span className="font-bold min-w-0 break-keep flex-1">{s.title || "(제목 없음)"}</span>
              {s.restaurant_name && <span className="badge bg-gray-100 text-gray-700">{s.restaurant_name}</span>}
            </div>

            {editing === s.id ? (
              <div className="flex flex-wrap items-end gap-2 mt-3">
                <div className="min-w-[220px]">
                  <label className="label text-sm" htmlFor={`at-${s.id}`}>새 발행 시각</label>
                  <input id={`at-${s.id}`} type="datetime-local" className="input"
                    value={at} min={data?.earliest} onChange={(e) => setAt(e.target.value)} />
                </div>
                <button className="btn-primary" disabled={busy === s.id}
                  onClick={() => void act(s.id, { action: "reschedule", publishAt: at }, "예약 시각을 바꿨습니다.")}>
                  {busy === s.id ? "저장 중…" : "이 시각으로"}
                </button>
                <button className="btn-ghost" onClick={() => setEditing(null)}>그만두기</button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2 mt-3">
                <Link className="btn-secondary" href={`/review/${s.reel_id}`}>🔎 미리보기</Link>
                <button className="btn-ghost" onClick={() => { setEditing(s.id); setAt(s.publish_at.slice(0, 16)); }}>
                  🕒 시각 수정
                </button>
                <Link className="btn-ghost" href={`/reel/${s.reel_id}`}>🚀 지금 발행</Link>
                <button className="btn-ghost text-red-600 hover:bg-red-50" disabled={busy === s.id}
                  onClick={() => void act(s.id, { action: "cancel" }, "예약을 취소했습니다. 내용은 그대로 있습니다.")}>
                  예약 취소
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {past.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-bold text-gray-700">지난 예약 {past.length}건 보기</summary>
          <div className="space-y-1 mt-2">
            {past.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center gap-2 text-sm py-1">
                <span className="text-gray-600 tabular-nums whitespace-nowrap">{s.publish_at.replace("T", " ").slice(0, 16)}</span>
                <StatusBadge status={s.status} />
                <span className="min-w-0 break-keep">{s.title}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </Card>
  );
}
