"use client";
import { useEffect, useState } from "react";
import { api } from "./ui";

/**
 * §8 예약 발행 — 발행 날짜와 시간을 사람이 직접 정한다.
 *
 * 예전에는 "다음 발행 슬롯" 으로만 잡혀서 사용자가 시각을 고를 수 없었다.
 */
export default function ScheduleDialog({ reelId, onClose, onScheduled }: {
  reelId: string;
  onClose: () => void;
  onScheduled: (at: string) => void;
}) {
  const [at, setAt] = useState("");
  const [earliest, setEarliest] = useState("");
  const [tz, setTz] = useState("Asia/Seoul");
  const [desktop, setDesktop] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<{ earliest: string; timezone: string; desktop: boolean }>("/api/schedules")
      .then((r) => { setEarliest(r.earliest); setTz(r.timezone); setDesktop(r.desktop); setAt((cur) => cur || r.earliest); })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api<{ publishAt: string }>(`/api/reels/${reelId}/schedule`, {
        method: "POST", body: JSON.stringify({ publishAt: at }),
      });
      onScheduled(r.publishAt);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4"
      role="dialog" aria-modal="true" aria-label="예약 발행">
      <div className="w-full max-w-lg my-10 rounded-2xl bg-white shadow-xl">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-xl font-extrabold">📅 예약 발행</h2>
          <p className="text-sm text-gray-600 mt-1">언제 올릴지 직접 정해 주세요.</p>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="label" htmlFor="sched-at">발행 날짜와 시간</label>
            <input id="sched-at" type="datetime-local" className="input"
              value={at} min={earliest} onChange={(e) => setAt(e.target.value)} />
            <p className="text-xs text-gray-600 mt-1.5">
              시간대 <b>{tz}</b> (한국 시각) · 가장 이른 예약 가능 시각 {earliest.replace("T", " ")}
            </p>
          </div>

          <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900">
            <b>⚠ 예약 시각에 이 프로그램이 켜져 있어야 합니다.</b>
            <br />
            발행은 사장님 PC 안에서 이뤄집니다. PC 가 꺼져 있거나 프로그램을 닫아 두면
            예약 시각이 지나도 올라가지 않고, 다시 켰을 때 이어서 진행합니다.
            {desktop && <><br />설치형 앱은 창을 닫으면 종료됩니다. 예약 시각까지 켜 두세요.</>}
          </div>

          {err && <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-700 break-words">{err}</div>}
        </div>

        <div className="p-6 border-t border-gray-200 flex flex-wrap gap-2 justify-end">
          <button className="btn-secondary" onClick={onClose} disabled={busy}>취소</button>
          <button className="btn-primary" onClick={() => void save()} disabled={busy || !at}>
            {busy ? "예약 중…" : "이 시각에 예약"}
          </button>
        </div>
      </div>
    </div>
  );
}
