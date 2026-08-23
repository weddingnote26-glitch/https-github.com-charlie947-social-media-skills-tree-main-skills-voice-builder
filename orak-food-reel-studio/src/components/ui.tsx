"use client";
import { useCallback, useEffect, useState } from "react";

export function Card({ title, right, children, className = "" }: {
  title?: string; right?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <section className={`card p-5 ${className}`}>
      {(title || right) && (
        <div className="flex items-center justify-between mb-4">
          {title && <h2 className="text-lg font-extrabold">{title}</h2>}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export const STATUS_COLOR: Record<string, string> = {
  기획: "bg-gray-100 text-gray-600",
  제작중: "bg-blue-100 text-blue-700",
  검수: "bg-amber-100 text-amber-800",
  승인: "bg-emerald-100 text-emerald-700",
  예약: "bg-violet-100 text-violet-700",
  발행완료: "bg-emerald-100 text-emerald-800",
  실패: "bg-red-100 text-red-700",
  대기: "bg-gray-100 text-gray-600",
  진행중: "bg-blue-100 text-blue-700",
  완료: "bg-emerald-100 text-emerald-700",
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${STATUS_COLOR[status] ?? "bg-gray-100 text-gray-600"}`}>{status}</span>;
}

export function ProgressBar({ pct, tone = "bg-[#E86A3A]" }: { pct: number; tone?: string }) {
  return (
    <div className="h-2.5 w-full rounded-full bg-gray-100 overflow-hidden">
      <div className={`h-full rounded-full transition-all ${tone}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </div>
  );
}

export function Stars({ n }: { n: number }) {
  return <span className="text-amber-500">{"★".repeat(n)}{"☆".repeat(5 - n)}</span>;
}

/* ---------- API helpers ---------- */

export async function api<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await res.json();
  if (!body.ok) throw new Error(body.error ?? `요청 실패 (${res.status})`);
  return body.data as T;
}

export function useApi<T>(url: string, refreshMs?: number): {
  data: T | null; error: string | null; loading: boolean; reload: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => {
    api<T>(url)
      .then((d) => { setData(d); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [url]);
  useEffect(() => {
    load();
    if (refreshMs) {
      const t = setInterval(load, refreshMs);
      return () => clearInterval(t);
    }
  }, [load, refreshMs]);
  return { data, error, loading, reload: load };
}

/** 로컬 파일 절대경로 → 미리보기 URL */
export function mediaUrl(absPath: string | null | undefined): string | null {
  if (!absPath) return null;
  const norm = absPath.replace(/\\/g, "/");
  const idx = norm.lastIndexOf("/output/");
  if (idx >= 0) return "/api/media" + norm.slice(idx);
  const ai = norm.lastIndexOf("/assets/");
  if (ai >= 0) return "/api/media" + norm.slice(ai);
  return null;
}

export function ErrorBox({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm font-semibold">{msg}</div>;
}
