"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

/**
 * 변경 완료 알림.
 *
 * 원칙
 *  - 무엇이 바뀌었는지 문장으로 알려준다("저장했습니다" 로 끝내지 않는다).
 *  - 실패했을 때 성공 알림을 띄우지 않는다.
 *  - 성공은 잠시 뒤 스스로 닫히고, 오류는 사용자가 닫을 때까지 남는다.
 *  - 다른 창(모달) 위에 뜬다.
 */

export type ToastKind = "success" | "error" | "info";

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  /** 실제로 바뀐 내용을 한 줄씩 */
  details?: string[];
  /** 오류일 때 다음에 무엇을 하면 되는지 */
  hint?: string;
}

interface ToastApi {
  /** 성공 — 잠시 뒤 자동으로 닫힌다 */
  success: (title: string, details?: string[]) => void;
  info: (title: string, details?: string[]) => void;
  /** 오류 — 사용자가 닫을 때까지 남는다 */
  error: (title: string, hint?: string) => void;
  /** Error 객체를 그대로 넘길 때 */
  fromError: (e: unknown, hint?: string) => void;
  dismiss: (id: number) => void;
}

const Ctx = createContext<ToastApi | null>(null);

/** 성공 알림이 스스로 닫히기까지 */
export const SUCCESS_TIMEOUT_MS = 5000;

export function useToast(): ToastApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("ToastProvider 안에서만 쓸 수 있습니다");
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t) { clearTimeout(t); timers.current.delete(id); }
    setItems((cur) => cur.filter((x) => x.id !== id));
  }, []);

  const push = useCallback((toast: Omit<Toast, "id">, autoCloseMs?: number) => {
    const id = nextId.current++;
    setItems((cur) => [...cur, { ...toast, id }]);
    if (autoCloseMs) {
      timers.current.set(id, setTimeout(() => dismiss(id), autoCloseMs));
    }
  }, [dismiss]);

  // 화면을 떠날 때 남은 타이머 정리
  useEffect(() => {
    const map = timers.current;
    return () => { for (const t of map.values()) clearTimeout(t); map.clear(); };
  }, []);

  const api: ToastApi = {
    success: (title, details) => push({ kind: "success", title, details }, SUCCESS_TIMEOUT_MS),
    info: (title, details) => push({ kind: "info", title, details }, SUCCESS_TIMEOUT_MS),
    // 오류는 자동으로 닫지 않는다 — 원인을 읽을 시간이 필요하다
    error: (title, hint) => push({ kind: "error", title, hint }),
    fromError: (e, hint) => push({ kind: "error", title: e instanceof Error ? e.message : String(e), hint }),
    dismiss,
  };

  return (
    <Ctx.Provider value={api}>
      {children}
      <ToastViewport items={items} onDismiss={dismiss} />
    </Ctx.Provider>
  );
}

const STYLE: Record<ToastKind, { box: string; icon: string; label: string }> = {
  success: { box: "bg-white border-emerald-300", icon: "✅", label: "완료" },
  error: { box: "bg-white border-red-300", icon: "❌", label: "오류" },
  info: { box: "bg-white border-gray-300", icon: "ℹ️", label: "안내" },
};

function ToastViewport({ items, onDismiss }: { items: Toast[]; onDismiss: (id: number) => void }) {
  // Esc 로 가장 최근 알림을 닫는다
  useEffect(() => {
    if (items.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss(items[items.length - 1].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, onDismiss]);

  return (
    // z-index 를 모달(z-50)보다 높게 둬서 어떤 창 위에서도 보이게 한다
    <div
      className="fixed top-4 right-4 z-[100] flex flex-col gap-2 w-[min(30rem,calc(100vw-2rem))] pointer-events-none"
      aria-live="polite"
      aria-atomic="false"
    >
      {items.map((t) => {
        const s = STYLE[t.kind];
        return (
          <div
            key={t.id}
            role={t.kind === "error" ? "alert" : "status"}
            className={`pointer-events-auto rounded-2xl border-2 shadow-lg px-4 py-3 flex gap-3 items-start ${s.box}`}
          >
            <span className="text-lg leading-6" aria-hidden="true">{s.icon}</span>
            <div className="flex-1 min-w-0">
              <span className="sr-only">{s.label}: </span>
              <p className="font-bold text-sm text-gray-900 break-words">{t.title}</p>
              {t.details && t.details.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {t.details.map((d, i) => (
                    <li key={i} className="text-sm text-gray-600 break-words">· {d}</li>
                  ))}
                </ul>
              )}
              {t.hint && <p className="text-sm text-gray-600 mt-1 break-words">{t.hint}</p>}
            </div>
            <button
              type="button"
              onClick={() => onDismiss(t.id)}
              aria-label="알림 닫기"
              className="shrink-0 rounded-lg px-2 py-1 text-gray-600 hover:bg-gray-100 hover:text-gray-700 font-bold cursor-pointer"
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
