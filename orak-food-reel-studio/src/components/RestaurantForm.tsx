"use client";
import { useEffect, useState } from "react";
import { Card, api } from "./ui";
import type { RestaurantForm as FormValue, ManualField, RecheckResult } from "@/lib/restaurants";

export type { FormValue };

/** 항목 하나의 확인 상태 알약. 팩트체크 카드와 입력 폼이 같은 색을 쓴다. */
export function FieldStatusBadge({ status }: { status: string }) {
  if (status === "확인") return <span className="badge bg-emerald-100 text-emerald-700">확인</span>;
  if (status === "사용자 입력") return <span className="badge bg-sky-100 text-sky-800">✍ 직접 입력</span>;
  return <span className="badge bg-amber-100 text-amber-800">⚠ 확인 필요</span>;
}

interface FieldDef { key: ManualField; label: string; hint?: string; area?: boolean; wide?: boolean; placeholder?: string }

/** 화면에 보여줄 순서. 자주 고치는 것부터 위로 둔다. */
const FIELDS: FieldDef[] = [
  { key: "name", label: "매장명", placeholder: "예: 신림 왕만두" },
  { key: "area", label: "지역", placeholder: "예: 관악구 신림동" },
  { key: "source_url", label: "업체 URL (출처)", wide: true, hint: "네이버 플레이스·홈페이지 등 정보를 본 곳", placeholder: "https://…" },
  { key: "address", label: "주소", wide: true, placeholder: "예: 서울 관악구 신림로 000" },
  { key: "phone", label: "전화번호", placeholder: "예: 02-000-0000" },
  { key: "map_url", label: "지도 링크", placeholder: "https://…" },
  { key: "menus", label: "메뉴 · 가격", area: true, wide: true, hint: "한 줄에 하나씩. 예) 왕만두 6,000원", placeholder: "왕만두 6,000원\n김치만두 6,500원" },
  { key: "hours", label: "영업시간", placeholder: "예: 매일 10:00~21:00" },
  { key: "closed_days", label: "휴무일", placeholder: "예: 매주 일요일" },
  { key: "parking", label: "주차", placeholder: "예: 가게 앞 2대 / 주차 불가" },
  { key: "reservation", label: "예약", placeholder: "예: 전화 예약 가능 / 예약 안 받음" },
  { key: "review_summary", label: "참고 메모", area: true, wide: true, hint: "어디서 확인했는지 적어 두면 나중에 헷갈리지 않습니다", placeholder: "2026-08-24 매장 방문해 메뉴판에서 직접 확인" },
];

/** 폼 항목 → 저장할 때 쓰는 이름 (메뉴만 여러 줄 글자라 이름이 다르다) */
function valueOf(v: FormValue, key: ManualField): string {
  return key === "menus" ? v.menus_text : (v[key] as string);
}
function withValue(v: FormValue, key: ManualField, next: string): FormValue {
  return key === "menus" ? { ...v, menus_text: next } : { ...v, [key]: next };
}

export interface SaveResult { id: string; form: FormValue; marked: ManualField[]; rechecked: RecheckResult[] }

/** 아직 아무것도 없는 빈 폼 — "업체 직접 등록" 에 쓴다 */
export function emptyForm(): FormValue {
  return {
    id: "", name: "", area: "관악구", source_url: "", address: "", phone: "", map_url: "",
    menus_text: "", hours: "", closed_days: "", parking: "", reservation: "", review_summary: "",
    field_status: {},
  };
}

/**
 * §6 업체 정보 직접 입력.
 * 자동 수집이 막힌 곳은 사람이 적어 넣는다. 적어 넣은 값은 "직접 입력" 으로 표시되고
 * 팩트체크에서 확인된 값과 같이 취급된다. 빈 칸은 저장은 되지만 "확인 필요" 로 남는다.
 */
export default function RestaurantForm({ value, title = "✏️ 업체 정보 직접 입력", onSaved }: {
  value: FormValue | null;
  title?: string;
  onSaved?: (r: SaveResult) => void;
}) {
  const [draft, setDraft] = useState<FormValue | null>(value);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // 화면이 몇 초마다 새로 읽어도 사람이 치던 글자를 지우지 않는다.
  // 다른 업체로 바뀌었을 때만(= id 가 달라졌을 때만) 새 값으로 채운다.
  const valueId = value?.id ?? null;
  useEffect(() => {
    setDraft(value);
    setDirty(false);
    setMsg(null);
    setErr(null);
    // value 는 4초마다 새로 오지만 내용은 같다 — id 가 바뀔 때만 다시 채운다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valueId]);

  if (!draft) {
    return (
      <Card title={title}>
        <p className="text-sm text-gray-600">연결된 업체 정보가 없습니다. 릴스를 다시 만들면 업체가 연결됩니다.</p>
      </Card>
    );
  }

  const set = (key: ManualField, next: string) => {
    setDirty(true); setMsg(null);
    setDraft((cur) => (cur ? withValue(cur, key, next) : cur));
  };

  const save = async () => {
    setBusy(true); setErr(null); setMsg(null);
    try {
      // id 가 없으면 새 업체 등록이다 (맛집 DB 화면의 "업체 직접 등록")
      const body: Record<string, string> = draft.id ? { id: draft.id } : {};
      for (const f of FIELDS) body[f.key === "menus" ? "menus_text" : f.key] = valueOf(draft, f.key);
      const r = await api<SaveResult>("/api/restaurants", { method: "PATCH", body: JSON.stringify(body) });
      setDraft(r.form); setDirty(false);
      const unblocked = r.rechecked.filter((x) => !x.blocked).length;
      const blocked = r.rechecked.filter((x) => x.blocked).length;
      setMsg(
        `업체 정보를 저장했습니다 — 직접 입력 ${r.marked.length}개.` +
        (r.rechecked.length ? ` 팩트체크 다시 확인: 통과 ${unblocked}건${blocked ? `, 아직 확인 필요 ${blocked}건` : ""}.` : "")
      );
      onSaved?.(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const need = FIELDS.filter((f) => !valueOf(draft, f.key).trim()).length;

  return (
    <Card title={title} right={
      <button className="btn-primary" disabled={busy || !draft.name.trim()} onClick={save}>
        {busy ? "저장 중…" : "💾 업체 정보 저장"}
      </button>
    }>
      <p className="text-sm text-gray-600 mb-4">
        자동으로 못 찾은 정보는 여기에 직접 적어 주세요. 적어 넣은 항목은 <b>직접 입력</b> 으로 표시되고
        팩트체크에서 확인된 정보로 봅니다. 빈 칸은 저장은 되지만 <b>확인 필요</b> 로 남습니다.
      </p>
      <div className="field-grid">
        {FIELDS.map((f) => {
          const v = valueOf(draft, f.key);
          const status = v.trim() ? (draft.field_status[f.key] ?? "미확인") : "미확인";
          return (
            <div key={f.key} className={f.wide ? "sm:col-span-2" : ""}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="label mb-0" htmlFor={`rf-${f.key}`}>{f.label}</label>
                <FieldStatusBadge status={dirty && v.trim() ? "사용자 입력" : status} />
              </div>
              {f.hint && <p className="text-xs text-gray-600 mb-1.5 mt-1">{f.hint}</p>}
              {f.area ? (
                <textarea id={`rf-${f.key}`} className="input mt-1.5" rows={f.key === "menus" ? 5 : 3}
                  value={v} placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)} />
              ) : (
                <input id={`rf-${f.key}`} className="input mt-1.5" value={v}
                  placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)} />
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button className="btn-primary" disabled={busy || !draft.name.trim()} onClick={save}>
          {busy ? "저장 중…" : "💾 업체 정보 저장"}
        </button>
        {dirty && <span className="text-sm font-bold text-amber-700">저장하지 않은 수정이 있습니다</span>}
        {need > 0 && <span className="text-sm text-gray-600">빈 칸 {need}개는 계속 “확인 필요” 로 표시됩니다</span>}
      </div>
      {msg && <div className="mt-3 rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-800">{msg}</div>}
      {err && <div className="mt-3 rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-700">{err}</div>}
    </Card>
  );
}
