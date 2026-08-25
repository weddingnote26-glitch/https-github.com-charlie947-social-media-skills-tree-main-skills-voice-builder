"use client";
import { useEffect, useState } from "react";
import { Card, api } from "./ui";
import RestaurantPicker from "./RestaurantPicker";
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
export default function RestaurantForm({ value, title = "✏️ 업체 정보 직접 입력", onSaved, onProduce }: {
  value: FormValue | null;
  title?: string;
  onSaved?: (r: SaveResult) => void;
  /** 주면 [저장하고 영상 제작하기] 단추가 생긴다. 저장이 끝난 뒤에만 불린다. */
  onProduce?: (r: SaveResult) => Promise<void> | void;
}) {
  const [draft, setDraft] = useState<FormValue | null>(value);
  const [dirty, setDirty] = useState(false);
  /** 사람이 직접 고친 항목 — DB 값으로 말없이 덮어쓰지 않는다 (§2-5 userEdited) */
  const [edited, setEdited] = useState<Set<ManualField>>(new Set());
  const [picking, setPicking] = useState(false);
  /** 불러온 DB 값과 지금 값이 다를 때 하나씩 고르게 한다 */
  const [compare, setCompare] = useState<{ from: FormValue; rows: ManualField[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // 화면이 몇 초마다 새로 읽어도 사람이 치던 글자를 지우지 않는다.
  // 다른 업체로 바뀌었을 때만(= id 가 달라졌을 때만) 새 값으로 채운다.
  const valueId = value?.id ?? null;
  useEffect(() => {
    setDraft(value);
    setDirty(false);
    setEdited(new Set());
    setPicking(false);
    setCompare(null);
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
    setEdited((cur) => new Set(cur).add(key));
    setDraft((cur) => (cur ? withValue(cur, key, next) : cur));
  };

  /**
   * 맛집 DB 에서 고른 업체를 폼에 채운다.
   *
   * 빈 칸은 그냥 채우고, 이미 값이 있거나 사람이 직접 고친 칸은
   * 덮어쓰지 않고 비교 화면으로 넘긴다 (§2-3, §2-5).
   * DB 가 비어 있는 항목은 임의로 만들어 넣지 않는다 (§2-7).
   */
  const pickFromDb = async (id: string) => {
    setErr(null); setMsg(null); setPicking(false);
    try {
      const r = await api<{ form: FormValue }>(`/api/restaurants?id=${encodeURIComponent(id)}`);
      const from = r.form;
      const conflicts: ManualField[] = [];
      let next = draft!;
      for (const f of FIELDS) {
        const dbVal = valueOf(from, f.key);
        const curVal = valueOf(next, f.key);
        if (!dbVal.trim()) continue;                       // DB 가 비었으면 건드리지 않는다
        if (dbVal === curVal) continue;
        if (curVal.trim() || edited.has(f.key)) { conflicts.push(f.key); continue; }
        next = withValue(next, f.key, dbVal);              // 빈 칸만 조용히 채운다
      }
      // 불러온 업체의 id 를 물려받아야 같은 업체가 새로 등록되지 않는다
      next = { ...next, id: from.id, field_status: from.field_status };
      setDraft(next);
      setDirty(true);
      if (conflicts.length) {
        setCompare({ from, rows: conflicts });
        setMsg(`맛집 DB에서 불러왔습니다. 값이 다른 항목 ${conflicts.length}개는 아래에서 골라 주세요.`);
      } else {
        setMsg("맛집 DB 정보를 폼에 채웠습니다. 확인 후 저장해 주세요.");
      }
    } catch (e) {
      setErr(`맛집 DB에서 불러오지 못했습니다. — ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  /** 비교 화면에서 한 항목을 DB 값으로 바꾼다 */
  const takeDb = (key: ManualField) => {
    if (!compare) return;
    setDraft((cur) => (cur ? withValue(cur, key, valueOf(compare.from, key)) : cur));
    setEdited((cur) => { const n = new Set(cur); n.delete(key); return n; });
    setCompare((c) => (c && c.rows.length > 1 ? { ...c, rows: c.rows.filter((k) => k !== key) } : null));
  };
  /** 지금 값을 그대로 둔다 */
  const keepMine = (key: ManualField) => {
    setEdited((cur) => new Set(cur).add(key));
    setCompare((c) => (c && c.rows.length > 1 ? { ...c, rows: c.rows.filter((k) => k !== key) } : null));
  };

  /**
   * 저장은 이 함수 하나만 한다. 위아래 단추가 서로 다른 저장 경로를 타면
   * 같은 업체가 두 번 등록되는 사고가 난다.
   * 저장과 영상 제작은 단계를 나눠 알린다 — 어디서 실패했는지 알아야 한다.
   */
  const save = async (opts: { thenProduce?: boolean } = {}) => {
    setBusy(true); setErr(null); setMsg(null);
    let saved: SaveResult;
    try {
      // id 가 없으면 새 업체 등록이다 (맛집 DB 화면의 "업체 직접 등록")
      const body: Record<string, string> = draft.id ? { id: draft.id } : {};
      for (const f of FIELDS) body[f.key === "menus" ? "menus_text" : f.key] = valueOf(draft, f.key);
      saved = await api<SaveResult>("/api/restaurants", { method: "PATCH", body: JSON.stringify(body) });
      setDraft(saved.form); setDirty(false);
      const unblocked = saved.rechecked.filter((x) => !x.blocked).length;
      const blocked = saved.rechecked.filter((x) => x.blocked).length;
      setMsg(
        `업체 정보가 저장되었습니다 — 직접 입력 ${saved.marked.length}개.` +
        (saved.rechecked.length ? ` 팩트체크 다시 확인: 통과 ${unblocked}건${blocked ? `, 아직 확인 필요 ${blocked}건` : ""}.` : "")
      );
      onSaved?.(saved);
    } catch (e) {
      setErr(`업체 정보를 저장하지 못했습니다. 다시 시도해 주세요. — ${e instanceof Error ? e.message : String(e)}`);
      setBusy(false);
      return;
    }

    if (!opts.thenProduce || !onProduce) { setBusy(false); return; }

    try {
      setMsg("업체 정보를 저장했습니다. 이어서 영상을 만듭니다…");
      await onProduce(saved);
    } catch (e) {
      // 어느 단계에서 멈췄는지 분명히 한다
      setErr(`업체 정보는 저장됐지만 영상 제작에 실패했습니다. — ${e instanceof Error ? e.message : String(e)}`);
    } finally { setBusy(false); }
  };

  /** 저장하지 않은 수정을 버리고 마지막 저장 상태로 되돌린다 */
  const cancel = () => {
    if (!value) return;
    setDraft(value); setDirty(false); setErr(null);
    setMsg("수정을 취소하고 저장된 내용으로 되돌렸습니다.");
  };

  /** 입력칸만 비운다 (저장하지 않으면 DB 는 그대로다) */
  const reset = () => {
    setDraft((cur) => {
      if (!cur) return cur;
      let next = cur;
      for (const f of FIELDS) if (f.key !== "name") next = withValue(next, f.key, "");
      return next;
    });
    setDirty(true); setErr(null);
    setMsg("입력칸을 비웠습니다. 저장하기 전까지 저장된 정보는 그대로입니다.");
  };

  const need = FIELDS.filter((f) => !valueOf(draft, f.key).trim()).length;

  const bottomId = `rf-actions-${draft.id || "new"}`;

  return (
    /* 저장 단추는 화면 아래 한 곳에만 둔다.
       위아래 두 곳에 두었더니 어느 것을 눌러야 하는지 헷갈렸다.
       위쪽은 그 자리로 데려다주는 바로가기 역할만 한다. */
    <Card title={title} right={
      <>
        <button className="btn-secondary" onClick={() => { setPicking((v) => !v); setCompare(null); }}>
          📇 맛집 DB에서 불러오기
        </button>
        {draft.id && (
          <button className="btn-ghost" title="저장된 업체 정보를 다시 읽어와 지금 값과 비교합니다"
            onClick={() => void pickFromDb(draft.id)}>🔄 DB 최신 정보 다시 적용</button>
        )}
        <button className="btn-ghost" onClick={() => {
          document.getElementById(bottomId)?.scrollIntoView({ behavior: "smooth", block: "center" });
        }}>맨 아래 저장 단추로 ↓</button>
      </>
    }>
      <p className="text-sm text-gray-600 mb-4">
        자동으로 못 찾은 정보는 여기에 직접 적어 주세요. 적어 넣은 항목은 <b>직접 입력</b> 으로 표시되고
        팩트체크에서 확인된 정보로 봅니다. 빈 칸은 저장은 되지만 <b>확인 필요</b> 로 남습니다.
      </p>
      {picking && (
        <RestaurantPicker
          excludeId={draft.id || undefined}
          onClose={() => setPicking(false)}
          onPick={(id) => void pickFromDb(id)}
        />
      )}

      {compare && compare.rows.length > 0 && (
        /* 말없이 덮어쓰지 않는다 — 다른 항목만 나란히 보여 주고 사람이 고른다 */
        <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 my-4">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <h3 className="text-base font-extrabold text-amber-900">
              ⚖️ 값이 다른 항목 {compare.rows.length}개 — 어느 쪽을 쓸까요?
            </h3>
            <div className="ml-auto flex flex-wrap gap-2">
              <button className="btn-secondary" onClick={() => compare.rows.slice().forEach(takeDb)}>전부 DB 값으로</button>
              <button className="btn-ghost" onClick={() => setCompare(null)}>전부 지금 값 유지</button>
            </div>
          </div>
          <div className="space-y-2 mt-3">
            {compare.rows.map((key) => {
              const label = FIELDS.find((f) => f.key === key)?.label ?? key;
              return (
                <div key={key} className="rounded-xl border border-amber-200 bg-white p-3">
                  <div className="font-bold text-sm mb-2">{label}</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                    <div className="min-w-0">
                      <div className="text-xs text-gray-600 mb-1">지금 값</div>
                      <div className="rounded-lg bg-gray-50 border border-gray-200 p-2 break-words whitespace-pre-wrap">
                        {valueOf(draft, key) || <span className="text-gray-500">(비어 있음)</span>}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs text-gray-600 mb-1">맛집 DB 값</div>
                      <div className="rounded-lg bg-sky-50 border border-sky-200 p-2 break-words whitespace-pre-wrap">
                        {valueOf(compare.from, key) || <span className="text-gray-500">(비어 있음)</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-2">
                    <button className="btn-secondary" onClick={() => takeDb(key)}>DB 값 적용</button>
                    <button className="btn-ghost" onClick={() => keepMine(key)}>현재 값 유지</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="field-grid">
        {FIELDS.map((f) => {
          const v = valueOf(draft, f.key);
          const status = v.trim() ? (draft.field_status[f.key] ?? "미확인") : "미확인";
          return (
            <div key={f.key} className={f.wide ? "sm:col-span-2" : ""}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="label mb-0" htmlFor={`rf-${f.key}`}>{f.label}</label>
                <div className="flex items-center gap-1.5">
                  {edited.has(f.key) && (
                    <span className="badge bg-gray-200 text-gray-700" title="직접 고친 항목입니다. 맛집 DB 값으로 말없이 바뀌지 않습니다.">
                      ✎ 직접 고침
                    </span>
                  )}
                  <FieldStatusBadge status={dirty && v.trim() ? "사용자 입력" : status} />
                </div>
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
      <div id={bottomId} className="mt-5 border-t border-gray-200 pt-4 scroll-mt-4">
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-primary" disabled={busy || !draft.name.trim()} onClick={() => void save()}>
            {busy ? "저장 중…" : "💾 업체 정보 저장"}
          </button>
          {onProduce && (
            <button className="btn-primary" disabled={busy || !draft.name.trim()}
              title="업체 정보를 저장한 뒤 이어서 영상을 만듭니다"
              onClick={() => void save({ thenProduce: true })}>
              🎬 저장하고 영상 제작하기
            </button>
          )}
          <button className="btn-secondary" disabled={busy || !dirty} onClick={cancel}>취소</button>
          <button className="btn-ghost" disabled={busy} onClick={reset}>초기화</button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          {dirty && <span className="text-sm font-bold text-amber-700">저장하지 않은 수정이 있습니다</span>}
          {need > 0 && <span className="text-sm text-gray-600">빈 칸 {need}개는 계속 “확인 필요” 로 표시됩니다</span>}
        </div>
      </div>
      {msg && <div className="mt-3 rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-800">{msg}</div>}
      {err && <div className="mt-3 rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-700">{err}</div>}
    </Card>
  );
}
