"use client";
import { useState } from "react";
import { Card, api, useApi, ErrorBox, StatusBadge } from "@/components/ui";

interface Restaurant {
  id: string; name: string; area: string; address: string | null; menus_json: string;
  field_status_json: string; source_url: string | null; updated_at: string;
}
interface Tip { id: string; restaurant_name: string; location: string; reason: string; submitted_by: string; status: string; case_number: number | null }

export default function RestaurantsPage() {
  const { data, reload } = useApi<{ restaurants: Restaurant[] }>("/api/restaurants");
  const { data: tips, reload: reloadTips } = useApi<{ tips: Tip[] }>("/api/tips");
  const [tab, setTab] = useState<"db" | "tips">("db");
  const [tip, setTip] = useState({ restaurant_name: "", location: "", reason: "", submitted_by: "" });
  const [err, setErr] = useState<string | null>(null);

  const addTip = async () => {
    try {
      await api("/api/tips", { method: "POST", body: JSON.stringify(tip) });
      setTip({ restaurant_name: "", location: "", reason: "", submitted_by: "" });
      reloadTips();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };

  const setTipStatus = async (id: string, status: string) => {
    try { await api("/api/tips", { method: "PATCH", body: JSON.stringify({ id, status }) }); reloadTips(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <div className="page space-y-6">
      <h1 className="text-2xl font-extrabold">🍽 맛집 DB</h1>
      <div className="flex gap-2">
        <button className={tab === "db" ? "btn-primary px-4 py-2 text-sm" : "btn-secondary px-4 py-2 text-sm"} onClick={() => setTab("db")}>조사된 맛집 ({data?.restaurants.length ?? 0})</button>
        <button className={tab === "tips" ? "btn-primary px-4 py-2 text-sm" : "btn-secondary px-4 py-2 text-sm"} onClick={() => setTab("tips")}>📮 맛집 제보 ({tips?.tips.length ?? 0})</button>
      </div>
      <ErrorBox msg={err} />

      {tab === "db" && (
        <Card>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-gray-600 font-bold border-b"><th className="py-2">매장명</th><th>지역</th><th>대표 메뉴</th><th>정보 상태</th></tr></thead>
            <tbody>
              {(data?.restaurants ?? []).map((r) => {
                const menus = JSON.parse(r.menus_json || "[]") as Array<{ name: string; price: string; verified: boolean }>;
                const st = JSON.parse(r.field_status_json || "{}") as Record<string, string>;
                const verified = Object.values(st).filter((v) => v === "확인").length;
                return (
                  <tr key={r.id} className="border-b border-gray-100">
                    <td className="py-2.5 font-bold">{r.name}</td>
                    <td>{r.area}</td>
                    <td className="text-gray-600">{menus.map((m) => `${m.name} ${m.price}`.trim()).join(", ") || "-"}</td>
                    <td><span className={`badge ${verified >= 5 ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>확인 {verified}/{Object.keys(st).length || 8}</span></td>
                  </tr>
                );
              })}
              {(data?.restaurants?.length ?? 0) === 0 && <tr><td colSpan={4} className="text-center text-gray-600 py-10">아직 조사된 맛집이 없습니다. 오늘의 릴스에서 첫 조사를 시작해보세요.</td></tr>}
            </tbody>
          </table>
          <button className="btn-ghost mt-3" onClick={reload}>새로고침</button>
        </Card>
      )}

      {tab === "tips" && (
        <>
          <Card title="새 제보 등록 — 댓글 제보를 여기 기록해두면 다음 사건이 됩니다">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input className="input" placeholder="맛집 이름 *" value={tip.restaurant_name} onChange={(e) => setTip({ ...tip, restaurant_name: e.target.value })} />
              <input className="input" placeholder="위치 (예: 신림역 3번 출구)" value={tip.location} onChange={(e) => setTip({ ...tip, location: e.target.value })} />
              <input className="input" placeholder="제보 이유" value={tip.reason} onChange={(e) => setTip({ ...tip, reason: e.target.value })} />
              <input className="input" placeholder="제보자 (인스타 아이디 등)" value={tip.submitted_by} onChange={(e) => setTip({ ...tip, submitted_by: e.target.value })} />
            </div>
            <button className="btn-primary mt-3" onClick={addTip} disabled={!tip.restaurant_name.trim()}>📮 제보 저장</button>
          </Card>
          <Card title="제보 목록">
            <div className="space-y-2">
              {(tips?.tips ?? []).map((t) => (
                <div key={t.id} className="flex items-center gap-3 rounded-xl border border-gray-200 p-3">
                  <div className="flex-1">
                    <div className="font-bold">{t.restaurant_name} <span className="text-gray-600 font-normal text-sm">{t.location}</span></div>
                    <div className="text-sm text-gray-600">{t.reason} {t.submitted_by && `— @${t.submitted_by}`}</div>
                  </div>
                  {t.case_number && <span className="badge bg-[#FDEDE5] text-[#B84A1B]">#{String(t.case_number).padStart(3, "0")}</span>}
                  <select className="input w-32" value={t.status} onChange={(e) => setTipStatus(t.id, e.target.value)}>
                    {["제보", "조사예정", "제작중", "완료"].map((s) => <option key={s}>{s}</option>)}
                  </select>
                  <StatusBadge status={t.status === "제보" ? "기획" : t.status === "완료" ? "완료" : "진행중"} />
                </div>
              ))}
              {(tips?.tips?.length ?? 0) === 0 && <div className="text-gray-600 text-sm py-6 text-center">아직 제보가 없습니다.</div>}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
