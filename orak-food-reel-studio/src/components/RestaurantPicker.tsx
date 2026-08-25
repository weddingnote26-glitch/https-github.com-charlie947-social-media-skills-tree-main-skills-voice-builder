"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "./ui";

export interface Brief {
  id: string; name: string; area: string; address: string; phone: string;
  menuSummary: string; confirmed: number; total: number; updated_at: string;
}

/**
 * §2 맛집 DB에서 불러오기 — 이미 조사해 둔 업체를 골라 폼에 채운다.
 *
 * 고르기만 하고 실제 반영은 부모(RestaurantForm)가 한다.
 * 기존 입력값을 말없이 덮어쓰지 않기 위해서다.
 */
export default function RestaurantPicker({ onPick, onClose, excludeId }: {
  onPick: (id: string, name: string) => void;
  onClose: () => void;
  excludeId?: string;
}) {
  const [q, setQ] = useState("");
  const [list, setList] = useState<Brief[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (query: string) => {
    setBusy(true); setErr(null);
    try {
      const r = await api<{ list: Brief[] }>(`/api/restaurants?q=${encodeURIComponent(query)}`);
      setList(r.list);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setList([]);
    } finally { setBusy(false); }
  }, []);

  useEffect(() => { void load(""); }, [load]);

  const rows = (list ?? []).filter((r) => r.id !== excludeId);

  return (
    <div className="rounded-2xl border-2 border-[#E86A3A] bg-[#FFF9F6] p-4 mt-4">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <h3 className="text-base font-extrabold text-[#B84A1B]">📇 맛집 DB에서 불러오기</h3>
        <button className="btn-ghost ml-auto" onClick={onClose}>닫기</button>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <input
          className="input flex-1 min-w-[220px]"
          placeholder="업체명 · 주소 · 전화번호로 찾기"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void load(q); }}
        />
        <button className="btn-secondary" disabled={busy} onClick={() => void load(q)}>
          {busy ? "찾는 중…" : "🔍 찾기"}
        </button>
        <button className="btn-ghost" disabled={busy} onClick={() => { setQ(""); void load(""); }}>새로고침</button>
      </div>

      {err && <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-3">{err}</div>}

      {list === null && <div className="text-sm text-gray-600 py-6 text-center">불러오는 중…</div>}

      {list !== null && rows.length === 0 && (
        <div className="text-sm text-gray-600 py-6 text-center">
          {q ? `“${q}” 로 찾은 업체가 없습니다.` : "아직 저장된 업체가 없습니다."}
        </div>
      )}

      {rows.length > 0 && (
        <>
          <p className="text-xs text-gray-600 mb-2">
            {q ? `${rows.length}곳 찾았습니다.` : `최근 등록 ${rows.length}곳`} — 누르면 아래 폼에 채웁니다.
            기존 입력값이 있으면 먼저 비교 화면을 보여 드립니다.
          </p>
          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {rows.map((r) => (
              <button key={r.id}
                className="w-full text-left rounded-xl border-2 border-gray-200 bg-white p-3 hover:border-[#E86A3A] focus:border-[#E86A3A] focus:outline-none transition"
                onClick={() => onPick(r.id, r.name)}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold break-keep">{r.name}</span>
                  {r.area && <span className="badge bg-gray-100 text-gray-700">{r.area}</span>}
                  <span className={`badge ${r.confirmed >= 5 ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>
                    확인 {r.confirmed}/{r.total}
                  </span>
                  <span className="ml-auto text-xs text-gray-500 whitespace-nowrap">
                    {(r.updated_at || "").slice(0, 10)}
                  </span>
                </div>
                {r.address && <div className="text-sm text-gray-600 mt-1 break-keep">{r.address}</div>}
                {r.menuSummary && <div className="text-xs text-gray-500 mt-1 truncate">{r.menuSummary}</div>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
