"use client";
import { useEffect } from "react";

/**
 * 화면에서 난 오류를 프로그램 로그로 보낸다.
 *
 * 배포판에는 개발자 도구가 없어 브라우저 오류를 볼 방법이 없었다.
 * 실제로 "설정 화면이 불러오는 중에서 멈춘다" 는 제보를 받고도
 * 원인을 확인하지 못한 일이 있었다.
 *
 * 같은 오류를 반복해 보내지 않고, 한 번 켤 때 20건까지만 보낸다.
 */
export default function ClientErrorLog() {
  useEffect(() => {
    const seen = new Set<string>();
    let sent = 0;

    const report = (message: string, where: string) => {
      const key = `${message}|${where}`;
      if (!message || seen.has(key) || sent >= 20) return;
      seen.add(key);
      sent++;
      // 보내다 실패해도 조용히 넘어간다 (오류를 보고하다 또 오류를 내지 않게)
      void fetch("/api/client-log", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ level: "error", message: message.slice(0, 2000), where: where.slice(0, 500) }),
      }).catch(() => {});
    };

    const onError = (e: ErrorEvent) => {
      report(e.message || String(e.error), `${e.filename ?? ""}:${e.lineno ?? 0}`);
    };
    const onReject = (e: PromiseRejectionEvent) => {
      const r = e.reason;
      report(r instanceof Error ? `${r.name}: ${r.message}` : String(r), location.pathname);
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onReject);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onReject);
    };
  }, []);

  return null;
}
