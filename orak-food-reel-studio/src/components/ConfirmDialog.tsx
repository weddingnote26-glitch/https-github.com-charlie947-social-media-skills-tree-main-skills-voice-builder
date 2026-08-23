"use client";
import { useEffect, useRef } from "react";

/**
 * 되돌릴 수 없는 작업 앞에 세우는 확인 창.
 * 무엇이 지워지는지 목록으로 보여주고, 기본 포커스는 [취소] 에 둔다
 * (Enter 를 습관적으로 눌러 삭제되는 일을 막기 위함).
 */
export interface ConfirmOptions {
  title: string;
  message: string;
  /** 실제로 영향을 받는 항목들 */
  items?: string[];
  /** 되돌릴 수 없음 등 추가 경고 */
  warning?: string;
  confirmLabel?: string;
  danger?: boolean;
}

export default function ConfirmDialog({
  open, options, onConfirm, onCancel, busy = false,
}: {
  open: boolean;
  options: ConfirmOptions | null;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) { e.preventDefault(); onCancel(); return; }
      if (e.key !== "Tab") return;
      // 포커스가 창 밖으로 나가지 않게 가둔다
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>("button:not([disabled])");
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!open || !options) return null;
  const o = options;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={() => !busy && onCancel()} aria-hidden="true" />
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-desc"
        className="relative card p-6 w-full max-w-lg"
      >
        <h2 id="confirm-title" className="text-xl font-extrabold mb-2">{o.title}</h2>
        <p id="confirm-desc" className="text-gray-600 mb-3">{o.message}</p>

        {o.items && o.items.length > 0 && (
          <ul className="mb-3 max-h-52 overflow-y-auto rounded-xl bg-gray-50 border border-gray-200 px-4 py-3 space-y-1">
            {o.items.map((it, i) => (
              <li key={i} className="text-sm text-gray-700 break-all">· {it}</li>
            ))}
          </ul>
        )}

        {o.warning && (
          <p className="mb-4 text-sm font-bold text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            ⚠ {o.warning}
          </p>
        )}

        <div className="flex gap-3 justify-end">
          <button ref={cancelRef} type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
            취소
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={o.danger === false ? "btn-primary px-5 py-3 text-base" : "btn-danger px-5 py-3 text-base"}
          >
            {busy ? "처리 중…" : (o.confirmLabel ?? "삭제")}
          </button>
        </div>
      </div>
    </div>
  );
}
