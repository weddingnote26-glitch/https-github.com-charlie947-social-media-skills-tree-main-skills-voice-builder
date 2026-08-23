import { apiLog } from "../db";
import { logWarn } from "../log";

export class ApiError extends Error {
  constructor(public service: string, public status: number, message: string) {
    super(message);
  }
}

/** §43 오류 처리 — 지수 백오프 재시도 */
export async function withRetry<T>(
  service: string,
  action: string,
  fn: () => Promise<T>,
  tries = 3,
  baseDelayMs = 1500,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const out = await fn();
      apiLog(service, action, true);
      return out;
    } catch (e) {
      lastErr = e;
      const status = e instanceof ApiError ? e.status : 0;
      apiLog(service, action, false, status, e instanceof Error ? e.message : String(e));
      // 4xx(429 제외)는 재시도해도 소용없음
      if (status >= 400 && status < 500 && status !== 429) break;
      if (i < tries - 1) {
        const wait = baseDelayMs * 2 ** i;
        logWarn(service, `${action} 실패 — ${wait}ms 후 재시도 (${i + 1}/${tries})`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  throw lastErr;
}

export async function fetchJson<T>(
  service: string,
  url: string,
  init: RequestInit,
): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) throw new ApiError(service, res.status, `${res.status} ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

export async function fetchBuffer(
  service: string,
  url: string,
  init: RequestInit,
): Promise<Buffer> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(service, res.status, `${res.status} ${text.slice(0, 300)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}
