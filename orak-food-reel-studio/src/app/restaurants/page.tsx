"use client";
import { useState } from "react";
import { Card, api, useApi, ErrorBox, StatusBadge } from "@/components/ui";
import RestaurantForm, { emptyForm, type FormValue } from "@/components/RestaurantForm";

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
  // 수기 입력 폼에 채워 넣을 업체. null 이면 폼을 닫아 둔다.
  const [editing, setEditing] = useState<FormValue | null>(null);

  /** 표에서 고른 업체를 폼에 불러온다 */
  const openEdit = async (id: string) => {
    setErr(null);
    try {
      const r = await api<{ form: FormValue }>(`/api/restaurants?id=${encodeURIComponent(id)}`);
      setEditing(r.form);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };

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
      <div className="flex flex-wrap gap-2">
        <button className="chip" aria-pressed={tab === "db"} onClick={() => setTab("db")}>조사된 맛집 ({data?.restaurants.length ?? 0})</button>
        <button className="chip" aria-pressed={tab === "tips"} onClick={() => setTab("tips")}>📮 맛집 제보 ({tips?.tips.length ?? 0})</button>
      </div>
      <ErrorBox msg={err} />

      {tab === "db" && (
        <>
          <Card right={
            <button className="btn-primary" onClick={() => setEditing(emptyForm())}>➕ 업체 직접 등록</button>
          }>
            {/* 좁은 폭에서 매장명이 낱자로 쪼개져 옆 칸 글자와 뒤섞여 보였다.
                열 폭을 못 박고, 표 자체를 가로로만 스크롤시킨다. */}
            <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px] table-fixed">
              <colgroup>
                <col className="w-[26%]" /><col className="w-[12%]" /><col className="w-[38%]" />
                <col className="w-[12%]" /><col className="w-[12%]" />
              </colgroup>
              <thead><tr className="text-left text-gray-600 font-bold border-b"><th className="py-2 pr-3">매장명</th><th className="pr-3">지역</th><th className="pr-3">대표 메뉴</th><th className="pr-3">정보 상태</th><th className="text-right">수정</th></tr></thead>
              <tbody>
                {(data?.restaurants ?? []).map((r) => {
                  const menus = JSON.parse(r.menus_json || "[]") as Array<{ name: string; price: string; verified: boolean }>;
                  const st = JSON.parse(r.field_status_json || "{}") as Record<string, string>;
                  // 사람이 직접 적어 넣은 값도 확인된 정보로 센다
                  const verified = Object.values(st).filter((v) => v === "확인" || v === "사용자 입력").length;
                  return (
                    <tr key={r.id} className="border-b border-gray-100 align-top">
                      <td className="py-2.5 pr-3 font-bold break-keep">{r.name}</td>
                      <td className="pr-3 whitespace-nowrap">{r.area}</td>
                      <td className="pr-3 text-gray-600 truncate" title={menus.map((m) => `${m.name} ${m.price}`.trim()).join(", ")}>
                        {menus.map((m) => `${m.name} ${m.price}`.trim()).join(", ") || "-"}
                      </td>
                      <td className="pr-3"><span className={`badge ${verified >= 5 ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>확인 {verified}/{Object.keys(st).length || 8}</span></td>
                      <td className="text-right whitespace-nowrap">
                        <button className="btn-ghost" onClick={() => openEdit(r.id)}>✏️ 정보 수정</button>
                      </td>
                    </tr>
                  );
                })}
                {(data?.restaurants?.length ?? 0) === 0 && <tr><td colSpan={5} className="text-center text-gray-600 py-10">아직 조사된 맛집이 없습니다. 오늘의 릴스에서 첫 조사를 시작하거나, 오른쪽 위 [업체 직접 등록] 으로 직접 적어 넣으세요.</td></tr>}
              </tbody>
            </table>
            </div>
            <button className="btn-ghost mt-3" onClick={reload}>새로고침</button>
          </Card>

          {editing && (
            <div className="space-y-2">
              <RestaurantForm
                value={editing}
                title={editing.id ? `✏️ ${editing.name} — 업체 정보 수정` : "➕ 업체 직접 등록"}
                onSaved={(r) => { setEditing(r.form); reload(); }}
              />
              <button className="btn-ghost" onClick={() => setEditing(null)}>입력 창 닫기</button>
            </div>
          )}
        </>
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
                  <select className="input w-full sm:w-32 min-w-0" value={t.status} onChange={(e) => setTipStatus(t.id, e.target.value)}>
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
