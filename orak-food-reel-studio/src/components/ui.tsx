"use client";
import { useCallback, useEffect, useState } from "react";
import { stepView, type ProgressStep } from "@/lib/pipeline/progress";

/**
 * 모든 박스가 쓰는 한 가지 모양.
 * 제목 → (오른쪽 도구) → 내용 순서를 고정해, 화면마다 배치가 달라지지 않게 한다.
 * 오른쪽 도구가 많은 화면에서도 좁은 폭에서 겹치지 않도록 줄바꿈을 허용한다.
 */
export function Card({ title, right, children, className = "" }: {
  title?: string; right?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <section className={`card p-6 ${className}`}>
      {(title || right) && (
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          {title && <h2 className="text-lg font-extrabold text-gray-900">{title}</h2>}
          {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export const STATUS_COLOR: Record<string, string> = {
  기획: "bg-gray-200 text-gray-800",
  제작중: "bg-blue-100 text-blue-700",
  검수: "bg-amber-100 text-amber-800",
  승인: "bg-emerald-100 text-emerald-700",
  예약: "bg-violet-100 text-violet-700",
  발행완료: "bg-emerald-100 text-emerald-800",
  실패: "bg-red-100 text-red-700",
  대기: "bg-gray-200 text-gray-800",
  진행중: "bg-blue-100 text-blue-700",
  완료: "bg-emerald-100 text-emerald-700",
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${STATUS_COLOR[status] ?? "bg-gray-200 text-gray-800"}`}>{status}</span>;
}

export function ProgressBar({ pct, tone = "bg-[#E86A3A]", indeterminate = false, label }: {
  pct: number; tone?: string; indeterminate?: boolean; label?: string;
}) {
  const value = Math.min(100, Math.max(0, Math.round(pct)));
  return (
    <div
      className="h-2.5 w-full rounded-full bg-gray-100 overflow-hidden"
      role="progressbar"
      aria-label={label}
      // 길이를 모를 때는 값을 비워 스크린리더가 "몇 %"라고 읽지 않게 한다
      aria-valuenow={indeterminate ? undefined : value}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={indeterminate ? "처리 중" : `${value}%`}
    >
      {indeterminate ? (
        <div className={`h-full w-full progress-indeterminate ${tone.replace("bg-", "text-")}`} />
      ) : (
        <div className={`h-full rounded-full transition-all ${tone}`} style={{ width: `${value}%` }} />
      )}
    </div>
  );
}

/** 제작 단계 한 줄 — 오늘의 릴스 화면과 제작중 화면이 같은 규칙을 쓴다 */
export function StepRow({ step }: { step: ProgressStep }) {
  const v = stepView(step);
  return (
    <div>
      <div className="flex justify-between text-sm font-bold mb-1 gap-3">
        <span className="shrink-0">{v.icon} {step.label}</span>
        <span className="text-gray-600 font-normal text-right break-words">{v.text}</span>
      </div>
      <ProgressBar pct={v.barPct} tone={v.tone} indeterminate={v.animated} label={step.label} />
    </div>
  );
}

export function Stars({ n }: { n: number }) {
  return <span className="text-amber-500">{"★".repeat(n)}{"☆".repeat(5 - n)}</span>;
}

/* ---------- API helpers ---------- */

interface OrakBridge {
  isDesktopApp?: boolean;
  openOutputFolder?: (folderName: string) => Promise<{ ok: boolean; reason?: string; opened?: string }>;
}
function bridge(): OrakBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { orak?: OrakBridge }).orak;
}

/** 설치형 앱인지 (Electron 껍데기가 preload 로 알려 준다) */
export function isDesktopApp(): boolean {
  return !!bridge()?.isDesktopApp;
}

/** 완성 영상 폴더를 탐색기로 연다. 설치형 앱에서만 된다 */
export function canOpenFolder(): boolean {
  return typeof bridge()?.openOutputFolder === "function";
}

export async function openOutputFolder(folderName: string): Promise<{ ok: boolean; reason?: string }> {
  const fn = bridge()?.openOutputFolder;
  if (!fn) return { ok: false, reason: "설치한 프로그램에서만 폴더를 열 수 있습니다" };
  try {
    return await fn(folderName);
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** 글을 클립보드에 담는다 (Instagram 에 붙여넣기용) */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export async function api<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    // 브라우저의 "Failed to fetch" 는 원인이 안 보인다. 실제로는 대부분 서버가 꺼진 경우.
    // 설치형 앱에는 검은 창이 없으므로 안내를 달리한다.
    throw new Error(
      isDesktopApp()
        ? "프로그램 내부 서버에 연결하지 못했습니다. 프로그램을 완전히 닫았다가 다시 켜 주세요."
        : "프로그램 서버에 연결하지 못했습니다. 검은 창(start.bat)이 켜져 있는지 확인하고, 꺼져 있으면 다시 실행해 주세요.",
    );
  }
  let body: { ok?: boolean; error?: string; data?: unknown };
  try {
    body = await res.json();
  } catch {
    throw new Error(`서버 응답을 읽지 못했습니다 (${res.status}). 검은 창의 오류 메시지를 확인해 주세요.`);
  }
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
  // 색만으로 구분하지 않는다 — 아이콘과 "오류" 글자를 함께 둔다
  return (
    <div role="alert" className="rounded-xl bg-red-50 border-2 border-red-300 text-red-900 px-4 py-3 font-semibold flex gap-2 items-start">
      <span aria-hidden="true">❌</span>
      <span><span className="sr-only">오류: </span>{msg}</span>
    </div>
  );
}
