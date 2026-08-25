import { NextResponse } from "next/server";
import { logError } from "./log";
import { redact, redactError } from "./redact";

export function ok(data: unknown, status = 200): NextResponse {
  return NextResponse.json({ ok: true, data }, { status });
}

export function fail(message: string, status = 400): NextResponse {
  // 모든 오류 응답이 여기를 지난다 — 비밀값이 화면까지 가지 않게 마지막으로 거른다
  return NextResponse.json({ ok: false, error: redact(message) }, { status });
}

export async function handle(fn: () => Promise<NextResponse> | NextResponse): Promise<NextResponse> {
  try {
    return await fn();
  } catch (e) {
    const msg = redactError(e);
    logError("api", msg);
    return fail(msg, 500);
  }
}
