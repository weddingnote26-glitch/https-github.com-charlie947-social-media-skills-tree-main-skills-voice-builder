import { handle, ok } from "@/lib/api";
import { logError, logWarn } from "@/lib/log";
import { redact } from "@/lib/redact";
import { z } from "zod";

export const dynamic = "force-dynamic";

const Schema = z.object({
  level: z.enum(["error", "warn"]).default("error"),
  message: z.string().max(2000),
  where: z.string().max(500).default(""),
});

/**
 * 화면(브라우저)에서 난 오류를 프로그램 로그에 함께 남긴다.
 *
 * 배포판에는 개발자 도구가 없어서, 화면이 "불러오는 중…" 에서 멈춰도
 * 원인이 브라우저 안에만 남고 아무도 볼 수 없었다.
 * 이제 logs/app-날짜.log 하나만 보면 서버·화면 양쪽이 다 보인다.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const body = Schema.parse(await req.json());
    // 화면에서 온 글은 그대로 믿지 않는다 — 길이를 자르고 비밀값을 거른다
    const line = redact(`${body.message}${body.where ? ` @ ${body.where}` : ""}`).slice(0, 1000);
    if (body.level === "warn") logWarn("browser", line);
    else logError("browser", line);
    return ok({ logged: true });
  });
}
