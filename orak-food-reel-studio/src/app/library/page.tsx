"use client";
import { useState } from "react";
import Link from "next/link";
import { Card, StatusBadge, api, useApi, mediaUrl } from "@/components/ui";
import ConfirmDialog, { type ConfirmOptions } from "@/components/ConfirmDialog";

interface Reel { id: string; title: string; status: string; planned_date: string; thumb_path: string | null; content_mode: string; case_number: number | null; duration_sec: number | null }

const FILTERS = ["전체", "검수", "승인", "예약", "발행완료", "실패", "🗑 휴지통"];

export default function Library() {
  const [filter, setFilter] = useState("전체");
  const trash = filter === "🗑 휴지통";
  const query = trash ? "?trash=1" : filter === "전체" ? "" : `?status=${encodeURIComponent(filter)}`;
  const { data, reload } = useApi<{ reels: Reel[] }>(`/api/reels${query}`, 6000);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmOptions | null>(null);
  const [onYes, setOnYes] = useState<(() => Promise<void>) | null>(null);

  const reels = data?.reels ?? [];
  const toggle = (id: string) => setPicked((cur) => {
    const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n;
  });
  const clear = () => setPicked(new Set());

  const run = async (action: "trash" | "restore", done: string) => {
    setBusy(true); setErr(null); setMsg(null);
    try {
      await api("/api/reels/bulk", { method: "POST", body: JSON.stringify({ action, ids: [...picked] }) });
      setMsg(done); clear(); reload();
    } catch (e) {
      // 실패하면 무엇을 고르고 있었는지는 그대로 둔다 — 다시 누르기만 하면 되게
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const askTrash = () => {
    setConfirm({
      title: "완성 콘텐츠 삭제",
      message: `선택한 완성 콘텐츠 ${picked.size}건을 목록에서 삭제하시겠습니까?`,
      warning: "영상 파일과 Instagram 게시물은 삭제되지 않으며, 휴지통에서 복원할 수 있습니다.",
      confirmLabel: "선택 삭제",
    });
    setOnYes(() => () => run("trash", `${picked.size}건을 휴지통으로 옮겼습니다. 영상 파일은 그대로 있습니다.`));
  };

  return (
    <div className="page space-y-6">
      <h1 className="text-2xl font-extrabold">✅ 완성 콘텐츠</h1>
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button key={f} onClick={() => { setFilter(f); clear(); }} className="chip" aria-pressed={filter === f}>{f}</button>
        ))}
      </div>

      {/* 선택 도구 — 0건이면 삭제를 잠근다 */}
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-secondary" disabled={reels.length === 0}
          onClick={() => setPicked(new Set(reels.map((r) => r.id)))}>전체 선택</button>
        <button className="btn-ghost" disabled={picked.size === 0} onClick={clear}>선택 해제</button>
        {trash ? (
          <button className="btn-primary" disabled={busy || picked.size === 0}
            onClick={() => void run("restore", `${picked.size}건을 복원했습니다.`)}>
            {busy ? "복원 중…" : `♻️ 선택 복원 (${picked.size})`}
          </button>
        ) : (
          <button className="btn-secondary text-red-600" disabled={busy || picked.size === 0} onClick={askTrash}>
            {busy ? "삭제 중…" : `🗑 선택 삭제 (${picked.size})`}
          </button>
        )}
        {trash && <span className="text-sm text-gray-600">휴지통 — 영상 파일은 지워지지 않았습니다. 복원하면 목록으로 돌아옵니다.</span>}
      </div>

      {msg && <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-800">{msg}</div>}
      {err && <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-700">{err}</div>}

      <Card>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {reels.map((r) => (
            <div key={r.id} className={`relative rounded-xl border-2 overflow-hidden transition ${picked.has(r.id) ? "border-[#E86A3A]" : "border-gray-200"}`}>
              {/* 체크박스는 카드 열기와 분리 — 눌러도 상세로 넘어가지 않는다 */}
              <label className="absolute top-2 left-2 z-10 flex items-center justify-center w-8 h-8 rounded-lg bg-white/90 border border-gray-300 cursor-pointer"
                onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" className="w-5 h-5 accent-[#E86A3A]" checked={picked.has(r.id)} onChange={() => toggle(r.id)} />
              </label>
              <Link href={`/reel/${r.id}`} className="block hover:opacity-95">
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
            </div>
          ))}
          {reels.length === 0 && (
            <div className="col-span-full text-center text-gray-600 py-14">
              {trash ? "휴지통이 비어 있습니다." : "해당 상태의 콘텐츠가 없습니다."}
            </div>
          )}
        </div>
      </Card>

      <ConfirmDialog open={!!confirm} options={confirm}
        onConfirm={() => { setConfirm(null); void onYes?.(); }}
        onCancel={() => setConfirm(null)} />
    </div>
  );
}
